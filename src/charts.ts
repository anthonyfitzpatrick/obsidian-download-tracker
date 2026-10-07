import { DropdownComponent, setTooltip } from 'obsidian';
import { formatTime } from './dates';
import {
	ChartFilter,
	FiguresCache,
	KindFilter,
	RANGES,
	Range,
	Series,
	periodTotals,
	Period,
	Point,
	earliestRelease,
	rangeEnds,
	periodSeries,
	gainSeries,
	releasesIn,
	Release,
	projectSlots,
	kindMatches,
	nameMatches,
	niceTicks,
} from './chart-data';
import { Row, Snapshot, formatCount } from './counts';
import type { Report } from './fetch';

type DateFormatter = (time: number | null, withTime?: boolean) => string;

interface History {
	figures: FiguresCache;
	progress: string;
	ensure: (ends: number[], pluginIds: string[]) => void;
}

const KIND_OPTIONS: { kind: KindFilter; label: string }[] = [
	{ kind: 'all', label: 'All' },
	{ kind: 'plugin', label: 'Plugins' },
	{ kind: 'theme', label: 'Themes' },
	{ kind: 'repo', label: 'Other repositories' },
];

export function renderCharts(
	parent: HTMLElement,
	report: Report,
	snapshots: Snapshot[],
	date: DateFormatter,
	filter: ChartFilter,
	onFilter: (filter: ChartFilter) => void,
	history: History,
): void {
	const all = [...report.plugins, ...report.themes, ...report.repos];
	const present = new Set(all.map((r) => r.kind));
	const options = KIND_OPTIONS.filter((o) => o.kind === 'all' || present.has(o.kind));
	if (!options.some((o) => o.kind === filter.kind)) filter.kind = 'all';

	const controls = parent.createDiv({ cls: 'download-tracker-filters' });
	// The date range comes first: it is the filter people reach for most.
	const range = new DropdownComponent(controls);
	for (const r of RANGES) range.addOption(r.range, r.label);
	range.selectEl.setAttr('aria-label', 'Date range');
	range.setValue(filter.range).onChange((value) => {
		filter.range = value as Range;
		onFilter(filter);
		draw();
	});
	const chipBar = controls.createDiv({ cls: 'download-tracker-chips', attr: { role: 'radiogroup', 'aria-label': 'Show' } });
	const search = controls.createEl('input', {
		cls: 'download-tracker-search',
		attr: { type: 'search', placeholder: 'Filter by name', 'aria-label': 'Filter by name' },
	});
	search.value = filter.query;
	const body = parent.createDiv({ cls: 'download-tracker-charts' });

	const draw = () => {
		body.empty();
		drawCharts(body, all, snapshots, date, filter, report.fetchedAt, history);
	};

	const chips: { kind: KindFilter; el: HTMLElement }[] = [];
	const mark = () => {
		for (const chip of chips) {
			chip.el.toggleClass('is-active', chip.kind === filter.kind);
			chip.el.setAttr('aria-checked', String(chip.kind === filter.kind));
		}
	};
	for (const option of options) {
		// Not a <button>: themes restyle buttons, which can hide a plain label.
		const el = chipBar.createDiv({ text: option.label, cls: 'download-tracker-chip', attr: { role: 'radio', tabindex: '0' } });
		chips.push({ kind: option.kind, el });
		const select = () => {
			filter.kind = option.kind;
			onFilter(filter);
			mark();
			draw();
		};
		el.addEventListener('click', select);
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				select();
			}
		});
	}
	mark();
	search.addEventListener('input', () => {
		filter.query = search.value;
		onFilter(filter);
		draw();
	});

	draw();
}

function drawCharts(
	parent: HTMLElement,
	all: Row[],
	snapshots: Snapshot[],
	date: DateFormatter,
	filter: ChartFilter,
	now: number,
	past: History,
): void {
	const rows = all.filter((r) => kindMatches(r.kind, filter.kind) && nameMatches(r.name, filter.query));
	if (rows.length === 0) {
		empty(parent, 'Nothing matches this filter.');
		return;
	}
	// Periods come from the whole group, not the filtered rows, so changing the filter
	// keeps the same dates and reuses the daily figures already fetched.
	const group = all.filter((r) => (filter.kind === 'repo' ? r.kind === 'repo' : r.kind !== 'repo'));
	const firstSnapshot = snapshots.length > 0 ? Math.min(...snapshots.map((s) => s.fetchedAt)) : null;
	const startAt = earliestRelease(group) ?? firstSnapshot;
	if (startAt === null) {
		empty(parent, 'There is no history to draw yet. Save a snapshot to start.');
		return;
	}
	const axis: PeriodAxis = { ...rangeEnds(filter.range, startAt, now), zero: filter.range === 'all', live: true };
	const slots = projectSlots(all, filter.kind);
	const releases = releasesIn(rows, slots, axis.start, now);
	past.ensure(
		axis.ends.slice(0, -1),
		group.filter((r) => r.kind === 'plugin').map((r) => r.id),
	);
	const sources =
		"Plugin points are Obsidian's published daily figures, which run a few days behind, so a line can rise at the last point, today's live count from the tables. Themes and other repositories have no published history, so their points come from your saved snapshots; before the first one, they are estimated as a straight rise from zero at release and drawn dashed.";

	const projects = card(
		parent,
		'Downloads by project',
		`One line per project, with a point at the end of each period in the chosen range. ${sources} Hover over a name in the legend to pick out its line, or over a period to see every value.`,
	);
	if (past.progress) projects.createEl('p', { text: past.progress, cls: 'download-tracker-chart-note' });
	const perProject = periodSeries(rows, slots, axis.ends, past.figures, snapshots);
	if (perProject.length === 0) empty(projects, 'No download counts are available.');
	else lines(projects, perProject, date, axis, releases);

	const gains = card(
		parent,
		'New downloads per period',
		'One line per project: the downloads gained in each complete period, so you can see whether a project is speeding up or slowing down. The period still running is left out, and so are estimated totals, so themes appear as your snapshots build up. Ticks under the axis mark releases; hover over one to see which.',
	);
	const completed: PeriodAxis = { ...axis, ends: axis.ends.slice(0, -1), zero: true, live: false };
	// Counted from zero before release, so a project's first period has a gain too.
	const perPeriod = gainSeries(periodSeries(rows, slots, axis.ends, past.figures, snapshots, true), axis.ends);
	if (perPeriod.length === 0) empty(gains, 'This needs two complete periods with recorded totals. Try a longer range.');
	else lines(gains, perPeriod, date, completed, releases.filter((r) => r.time <= (completed.ends[completed.ends.length - 1] ?? 0)));

	const totals = card(
		parent,
		'Total downloads over time',
		`Totals at the end of each period: plugins, themes and both together. ${sources}`,
	);
	const series = periodTotals(rows, filter.kind, axis.ends, past.figures, snapshots);
	if (series.length === 0) empty(totals, 'No counts include these projects yet.');
	else lines(totals, series, date, axis);

	if (rows.some((r) => r.kind !== 'plugin')) {
		parent.createEl('p', {
			text: 'Themes and other repositories have no published history, so their lines are estimated (dashed) until your first saved snapshot. The daily snapshot setting records them from now on.',
			cls: 'download-tracker-chart-note',
		});
	}
}

function card(parent: HTMLElement, title: string, help: string): HTMLElement {
	const el = parent.createDiv({ cls: 'download-tracker-chart' });
	const head = el.createDiv({ cls: 'download-tracker-chart-head' });
	head.createEl('h4', { text: title });
	const details = head.createEl('details', { cls: 'download-tracker-chart-help' });
	details.createEl('summary', { text: 'How to read this' });
	details.createEl('p', { text: help });
	return el;
}

function empty(parent: HTMLElement, text: string): void {
	parent.createEl('p', { text, cls: 'download-tracker-empty' });
}

function legend(
	parent: HTMLElement,
	items: { id: string; label: string; cls: string }[],
	frame: HTMLElement,
	marks: Map<string, Element[]>,
): void {
	const el = parent.createDiv({ cls: 'download-tracker-legend' });
	for (const item of items) {
		const entry = el.createSpan({ cls: 'download-tracker-legend-item' });
		shape(entry.createSpan({ cls: `download-tracker-swatch ${item.cls}` }), item.cls);
		entry.createSpan({ text: item.label });
		// Picking out one line fades the others, so it can be followed through crossings.
		entry.tabIndex = 0;
		const on = () => {
			frame.addClass('has-highlight');
			for (const m of marks.get(item.id) ?? []) m.classList.add('is-highlighted');
		};
		const off = () => {
			frame.removeClass('has-highlight');
			for (const m of marks.get(item.id) ?? []) m.classList.remove('is-highlighted');
		};
		entry.addEventListener('mouseenter', on);
		entry.addEventListener('mouseleave', off);
		entry.addEventListener('focus', on);
		entry.addEventListener('blur', off);
	}
}

// One shape per colour slot, in a 10 by 10 box: circle, square, triangle, diamond,
// downward triangle, pentagon, hexagon and plus.
const SHAPES: Record<string, { tag: 'circle' | 'rect' | 'polygon'; attr: Record<string, string> }> = {
	'is-slot-1': { tag: 'circle', attr: { cx: '5', cy: '5', r: '5' } },
	'is-slot-2': { tag: 'rect', attr: { x: '0.5', y: '0.5', width: '9', height: '9', rx: '1' } },
	'is-slot-3': { tag: 'polygon', attr: { points: '5,0 10,10 0,10' } },
	'is-slot-4': { tag: 'polygon', attr: { points: '5,0 10,5 5,10 0,5' } },
	'is-slot-5': { tag: 'polygon', attr: { points: '0,0 10,0 5,10' } },
	'is-slot-6': { tag: 'polygon', attr: { points: '5,0 10,3.8 8.2,10 1.8,10 0,3.8' } },
	'is-slot-7': { tag: 'polygon', attr: { points: '2.5,0 7.5,0 10,5 7.5,10 2.5,10 0,5' } },
	'is-slot-8': { tag: 'polygon', attr: { points: '3.5,0 6.5,0 6.5,3.5 10,3.5 10,6.5 6.5,6.5 6.5,10 3.5,10 3.5,6.5 0,6.5 0,3.5 3.5,3.5' } },
};

function shape(el: HTMLElement, cls: string): void {
	const def = SHAPES[cls];
	if (!def) return;
	const svg = el.createSvg('svg', { attr: { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, cls: 'download-tracker-shape' });
	svg.createSvg(def.tag, { attr: def.attr });
}

function focusable(el: HTMLElement, tip: string): void {
	el.tabIndex = 0;
	el.setAttr('aria-label', tip);
	setTooltip(el, tip);
}

interface PeriodAxis {
	start: number;
	ends: number[];
	period: Period;
	// True when the last point is now rather than the end of a period.
	live: boolean;
	// All time starts at zero; shorter ranges start near the lowest value so growth shows.
	zero: boolean;
}

// Positions are percentages handed to the stylesheet as custom properties.
function place(el: HTMLElement, left: number | null, top: number | null): void {
	const props: Record<string, string> = {};
	if (left !== null) props['--dt-left'] = `${left}%`;
	if (top !== null) props['--dt-top'] = `${top}%`;
	el.setCssProps(props);
}

// One point per period, evenly spaced, with every period labelled where there is room.
function lines(parent: HTMLElement, series: Series[], date: DateFormatter, periods: PeriodAxis, releases: Release[] = []): void {
	const all = periods.ends;
	const values = series.flatMap((s) => s.points.map((p) => p.value));
	const ticks = niceTicks(periods.zero ? Math.min(0, ...values) : Math.min(...values), Math.max(...values));
	const low = ticks[0] ?? 0;
	const high = ticks[ticks.length - 1] ?? 1;
	const lastTime = all[all.length - 1] ?? 0;
	const index = new Map(all.map((t, i) => [t, i]));
	const x = (t: number) => 3 + ((index.get(t) ?? 0) / Math.max(all.length - 1, 1)) * 94;
	const y = (v: number) => 100 - ((v - low) / (high - low || 1)) * 100;
	const isToday = (i: number) => periods.live && i === all.length - 1;
	const daily = periods.period === 'day' || periods.period === 'week';
	// A period's end is the start of the next one, so it is named by its last day or month.
	const pointLabel = (t: number, i: number) =>
		isToday(i) ? 'Today' : daily ? date(t - 1) : formatTime(t - 1, 'MMM YYYY');
	// Axis labels are short so several fit; tooltips carry the full date.
	const axisLabel = (t: number, i: number) => (isToday(i) ? 'Today' : formatTime(t - 1, daily ? 'D MMM' : 'MMM YY'));

	const frame = parent.createDiv({ cls: 'download-tracker-line' });
	const marks = new Map<string, Element[]>();
	const yAxis = frame.createDiv({ cls: 'download-tracker-line-y' });
	const plot = frame.createDiv({ cls: 'download-tracker-line-plot' });
	for (const tick of ticks) {
		place(yAxis.createSpan({ text: formatCount(tick) }), null, y(tick));
		place(plot.createDiv({ cls: 'download-tracker-gridline' }), null, y(tick));
	}

	const svg = plot.createSvg('svg', {
		attr: { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
		cls: 'download-tracker-line-svg',
	});
	// The combined total is drawn last, so it stays visible where it runs along a part.
	const drawOrder = [...series].sort((a, b) => Number(a.id === 'total') - Number(b.id === 'total'));
	for (const s of drawOrder) {
		const own: Element[] = [];
		// A line breaks where periods are missing, rather than bridging a gap it can't vouch for.
		const segments: Point[][] = [];
		for (const p of s.points) {
			const current = segments[segments.length - 1];
			const prev = current?.[current.length - 1];
			const gap = prev && (index.get(p.time) ?? 0) - (index.get(prev.time) ?? 0) > 1;
			if (!current || gap) segments.push([p]);
			else current.push(p);
		}
		for (const segment of segments) {
			const coords = segment.map((p) => `${x(p.time)},${y(p.value)}`);
			// A wash under one line helps; under several lines the washes stack into noise.
			if (series.length === 1) {
				const left = x(segment[0]?.time ?? 0);
				const right = x(segment[segment.length - 1]?.time ?? lastTime);
				own.push(
					svg.createSvg('polygon', {
						attr: { points: `${left},100 ${coords.join(' ')} ${right},100` },
						cls: ['download-tracker-line-area', s.cls],
					}),
				);
			}
			// Dashed wherever either end of a step is an estimate.
			let run: Point[] = [];
			let dashed = false;
			const flush = () => {
				if (run.length < 2) return;
				const cls = ['download-tracker-line-stroke', s.cls];
				if (dashed) cls.push('is-estimated');
				own.push(svg.createSvg('polyline', { attr: { points: run.map((p) => `${x(p.time)},${y(p.value)}`).join(' ') }, cls }));
			};
			segment.forEach((p, i) => {
				const prev = segment[i - 1];
				if (!prev) {
					run = [p];
					return;
				}
				const stepDashed = Boolean(prev.estimated || p.estimated);
				if (run.length > 1 && stepDashed !== dashed) {
					flush();
					run = [prev];
				}
				dashed = stepDashed;
				run.push(p);
			});
			flush();
		}
		for (const p of s.points) {
			const dot = plot.createDiv({ cls: `download-tracker-line-dot ${s.cls}${p.estimated ? ' is-estimated' : ''}` });
			shape(dot, s.cls);
			place(dot, x(p.time), y(p.value));
			own.push(dot);
		}
		marks.set(s.id, own);
	}

	// One hit column per date, so the pointer only has to find the date, not a line.
	all.forEach((t, i) => {
		const hit = plot.createDiv({ cls: 'download-tracker-line-hit' });
		place(hit, x(t), null);
		const parts = series
			.map((s) => ({ label: s.label, point: s.points.find((p) => p.time === t) }))
			.filter((p): p is { label: string; point: Point } => p.point !== undefined)
			.sort((a, b) => b.point.value - a.point.value)
			.map((p) => `${p.label} ${formatCount(p.point.value)}${p.point.estimated ? ' (estimated)' : ''}`);
		focusable(hit, `${pointLabel(t, i)}: ${parts.join(', ')}`);
	});

	// End values only where they don't collide; the legend and tooltip carry the rest.
	const endLabels = frame.createDiv({ cls: 'download-tracker-line-ends' });
	const placed: number[] = [];
	const lasts = series
		.map((s) => s.points[s.points.length - 1])
		.filter((p): p is Point => p !== undefined && p.time === lastTime)
		.sort((a, b) => b.value - a.value);
	for (const last of lasts) {
		const top = y(last.value);
		if (placed.some((p) => Math.abs(p - top) < 9)) continue;
		placed.push(top);
		place(endLabels.createSpan({ text: formatCount(last.value), cls: 'download-tracker-line-end' }), null, top);
	}

	if (releases.length > 0) markers(frame, releases, periods, x, date, marks);

	// Label every period that fits: up to ten on a wide pane, three on a narrow one.
	const xAxis = frame.createDiv({ cls: 'download-tracker-line-x' });
	const wide = Math.ceil(all.length / 10);
	const narrow = Math.ceil(all.length / 3);
	all.forEach((t, i) => {
		const lastOne = i === all.length - 1;
		const showWide = lastOne || (i % wide === 0 && all.length - 1 - i >= wide / 2);
		if (!showWide) return;
		const showNarrow = lastOne || (i % narrow === 0 && all.length - 1 - i >= narrow / 2);
		place(xAxis.createSpan({ text: axisLabel(t, i), cls: showNarrow ? '' : 'is-wide-only' }), x(t), null);
	});

	if (series.length > 1) legend(parent, series, frame, marks);
	if (series.some((s) => s.points.some((p) => p.estimated))) {
		const key = parent.createDiv({ cls: 'download-tracker-legend download-tracker-estimate-key' });
		const item = key.createSpan({ cls: 'download-tracker-legend-item' });
		item.createSpan({ cls: 'download-tracker-dash-key' });
		item.createSpan({ text: 'Estimated: no record exists for these dates' });
	}
}

// Release ticks under the plot, placed by date between the period points. Releases
// on the same spot share one tick; it takes the project's colour, or grey if mixed.
function markers(
	frame: HTMLElement,
	releases: Release[],
	periods: PeriodAxis,
	x: (t: number) => number,
	date: DateFormatter,
	marks: Map<string, Element[]>,
): void {
	const ends = periods.ends;
	const at = (t: number): number => {
		const i = ends.findIndex((e) => e >= t);
		if (i === -1) return x(ends[ends.length - 1] ?? t);
		const end = ends[i] ?? t;
		const prev = i > 0 ? (ends[i - 1] ?? periods.start) : periods.start;
		const step = i > 0 ? x(end) - x(prev) : (x(ends[1] ?? end) - x(end)) || 0;
		const from = i > 0 ? x(prev) : x(end) - step;
		const share = end > prev ? (t - prev) / (end - prev) : 1;
		return Math.max(0, from + share * step);
	};
	const groups: { left: number; items: Release[] }[] = [];
	for (const r of releases) {
		const left = at(r.time);
		const group = groups.find((g) => Math.abs(g.left - left) < 1);
		if (group) group.items.push(r);
		else groups.push({ left, items: [r] });
	}
	const strip = frame.createDiv({ cls: 'download-tracker-markers' });
	for (const g of groups) {
		const ids = new Set(g.items.map((r) => r.id));
		const first = g.items[0];
		const cls = ids.size === 1 && first ? first.cls : 'is-mixed';
		const tick = strip.createDiv({ cls: `download-tracker-marker ${cls}` });
		place(tick, g.left, null);
		focusable(tick, g.items.map((r) => `${r.project} ${r.version}, ${date(r.time)}`).join('; '));
		for (const id of ids) marks.set(id, [...(marks.get(id) ?? []), tick]);
	}
}
