import { moment, setTooltip } from 'obsidian';
import {
	ChartFilter,
	Current,
	FiguresCache,
	KindFilter,
	Series,
	historySeries,
	Period,
	earliestRelease,
	periodEnds,
	periodSeries,
	projectSlots,
	kindMatches,
	nameMatches,
	niceTicks,
	versionsOldestFirst,
} from './chart-data';
import { Row, Snapshot, delta, formatCount, formatDelta } from './counts';
import type { Report } from './fetch';

type DateFormatter = (time: number | null, withTime?: boolean) => string;

export interface History {
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
	previous: Snapshot | undefined,
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
	const chipBar = controls.createDiv({ cls: 'download-tracker-chips', attr: { role: 'radiogroup', 'aria-label': 'Show' } });
	const search = controls.createEl('input', {
		cls: 'download-tracker-search',
		attr: { type: 'search', placeholder: 'Filter by name', 'aria-label': 'Filter by name' },
	});
	search.value = filter.query;
	const body = parent.createDiv({ cls: 'download-tracker-charts' });

	const draw = () => {
		body.empty();
		drawCharts(body, all, snapshots, previous, date, filter, { time: report.fetchedAt, rows: all }, history);
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
	previous: Snapshot | undefined,
	date: DateFormatter,
	filter: ChartFilter,
	current: Current,
	past: History,
): void {
	const rows = all.filter((r) => kindMatches(r.kind, filter.kind) && nameMatches(r.name, filter.query));
	if (rows.length === 0) {
		empty(parent, 'Nothing matches this filter.');
		return;
	}
	const needHistory = 'Save a snapshot to start this line. Each snapshot adds a point, and today’s counts are the last one.';

	const projects = card(
		parent,
		'Downloads by project',
		'One line per project, with a point at the end of each period from the earliest release to today. Plugin points are Obsidian’s published daily figures, which run a few days behind, so a line can rise at the last point, which is today’s live count from the tables. Themes and other repositories have no published history; their points come from your saved snapshots. Hover over a name in the legend to pick out its line, or over a period to see every value.',
	);
	// Periods come from the whole group, not the filtered rows, so changing the filter
	// keeps the same dates and reuses the daily figures already fetched.
	const group = all.filter((r) => (filter.kind === 'repo' ? r.kind === 'repo' : r.kind !== 'repo'));
	const firstSnapshot = snapshots.length > 0 ? Math.min(...snapshots.map((s) => s.fetchedAt)) : null;
	const startAt = earliestRelease(group) ?? firstSnapshot;
	if (startAt === null) empty(projects, 'There is no history to draw yet.');
	else {
		const { ends, period } = periodEnds(startAt, current.time);
		past.ensure(
			ends.slice(0, -1),
			group.filter((r) => r.kind === 'plugin').map((r) => r.id),
		);
		if (past.progress) projects.createEl('p', { text: past.progress, cls: 'download-tracker-chart-note' });
		const perProject = periodSeries(rows, projectSlots(all, filter.kind), ends, past.figures, snapshots);
		if (perProject.length === 0) empty(projects, 'No download counts are available.');
		else lines(projects, perProject, date, { ends, period });
		if (rows.some((r) => r.kind !== 'plugin')) {
			projects.createEl('p', {
				text: 'Themes and other repositories have no published history, so their lines start at your first saved snapshot.',
				cls: 'download-tracker-chart-note',
			});
		}
	}

	const history = card(parent, 'Total downloads over time', 'Each point is a saved snapshot; the last is today’s counts.');
	const series = historySeries(snapshots, filter, current);
	if (series.length === 0) empty(history, 'No counts include these projects yet.');
	else if (snapshots.length === 0) empty(history, needHistory);
	else lines(history, series, date);

	if (previous) {
		const changes = rows
			.map((r) => ({ row: r, change: delta(r, previous) }))
			.filter((c): c is { row: Row; change: number } => c.change !== null);
		if (changes.length > 0) {
			const since = card(
				parent,
				'Since the last snapshot',
				`Compared with ${date(previous.fetchedAt, true)}. A bar left of the centre line means the count went down, usually because it now comes from a source that lags.`,
			);
			changeBars(since, changes);
		}
	}

	const withVersions = rows.filter((r) => r.versions.length > 1);
	if (withVersions.length > 0) {
		const versions = card(parent, 'Downloads by version', 'Oldest version on the left. Each chart has its own scale.');
		const grid = versions.createDiv({ cls: 'download-tracker-multiples' });
		for (const r of withVersions) versionColumns(grid, r);
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
	key: 'box' | 'line',
	frame?: HTMLElement,
	marks?: Map<string, Element[]>,
): void {
	const el = parent.createDiv({ cls: 'download-tracker-legend' });
	for (const item of items) {
		const entry = el.createSpan({ cls: 'download-tracker-legend-item' });
		entry.createSpan({ cls: `download-tracker-swatch ${item.cls} is-${key}` });
		entry.createSpan({ text: item.label });
		if (!frame || !marks) continue;
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

function focusable(el: HTMLElement, tip: string): void {
	el.tabIndex = 0;
	el.setAttr('aria-label', tip);
	setTooltip(el, tip);
}

function changeBars(parent: HTMLElement, changes: { row: Row; change: number }[]): void {
	const sorted = [...changes].sort((a, b) => b.change - a.change);
	const max = Math.max(...sorted.map((c) => Math.abs(c.change)), 1);
	const hasNegative = sorted.some((c) => c.change < 0);
	const list = parent.createDiv({ cls: 'download-tracker-bars' });
	for (const { row, change } of sorted) {
		const el = list.createDiv({ cls: 'download-tracker-bar-row' });
		focusable(el, `${row.name}: ${formatDelta(change)} downloads`);
		el.createDiv({ text: row.name, cls: 'download-tracker-bar-label' });
		const track = el.createDiv({ cls: 'download-tracker-bar-track' + (hasNegative ? ' is-diverging' : '') });
		const plot = hasNegative ? track.createDiv({ cls: 'download-tracker-bar-plot' }) : track;
		const width = (Math.abs(change) / max) * (hasNegative ? 50 : 100);
		plot.createDiv({ cls: `download-tracker-bar-fill ${change < 0 ? 'is-negative' : 'is-positive'}` }).style.width =
			`${width}%`;
		track.createSpan({ text: formatDelta(change), cls: 'download-tracker-bar-value' });
	}
}

function versionColumns(parent: HTMLElement, row: Row): void {
	const versions = versionsOldestFirst(row.versions);
	const max = Math.max(...versions.map((v) => v.downloads), 1);
	const tallest = versions.reduce((a, b) => (b.downloads > a.downloads ? b : a));
	const el = parent.createDiv({ cls: 'download-tracker-multiple' });
	el.createDiv({ text: row.name, cls: 'download-tracker-multiple-title' });
	const plot = el.createDiv({ cls: `download-tracker-columns is-${row.kind}` });
	for (const v of versions) {
		const slot = plot.createDiv({ cls: 'download-tracker-column-slot' });
		focusable(slot, `${row.name} ${v.version}: ${formatCount(v.downloads)} downloads`);
		if (v === tallest) slot.createSpan({ text: formatCount(v.downloads), cls: 'download-tracker-column-value' });
		slot.createDiv({ cls: 'download-tracker-column' }).style.height = `${(v.downloads / max) * 100}%`;
	}
	const axis = el.createDiv({ cls: 'download-tracker-columns-axis' });
	axis.createSpan({ text: versions[0]?.version ?? '' });
	axis.createSpan({ text: versions[versions.length - 1]?.version ?? '' });
}

interface PeriodAxis {
	ends: number[];
	period: Period;
}

// Without periods, x is proportional to time. With periods, the points are evenly
// spaced, one per period, and every period is labelled where there is room.
function lines(parent: HTMLElement, series: Series[], date: DateFormatter, periods?: PeriodAxis): void {
	const times = periods ?? { ends: [...new Set(series.flatMap((s) => s.points.map((p) => p.time)))].sort((a, b) => a - b) };
	const all = times.ends;
	const values = series.flatMap((s) => s.points.map((p) => p.value));
	const ticks = niceTicks(Math.min(0, ...values), Math.max(...values));
	const low = ticks[0] ?? 0;
	const high = ticks[ticks.length - 1] ?? 1;
	const first = all[0] ?? 0;
	const lastTime = all[all.length - 1] ?? first;
	const span = Math.max(lastTime - first, 1);
	const index = new Map(all.map((t, i) => [t, i]));
	const x = periods
		? (t: number) => 3 + ((index.get(t) ?? 0) / Math.max(all.length - 1, 1)) * 94
		: (t: number) => ((t - first) / span) * 100;
	const y = (v: number) => 100 - ((v - low) / (high - low || 1)) * 100;
	// A period's end is the start of the next one, so it is named by its last day or month.
	const pointLabel = (t: number, i: number) => {
		if (!periods) return date(t, true);
		if (i === all.length - 1) return 'Today';
		return periods.period === 'week' ? date(t - 1) : moment(t - 1).format('MMM YYYY');
	};
	// Axis labels are short so several fit; tooltips carry the full date.
	const axisLabel = (t: number, i: number) => {
		if (i === all.length - 1) return 'Today';
		return moment(t - 1).format(periods?.period === 'week' ? 'D MMM' : 'MMM YY');
	};

	const frame = parent.createDiv({ cls: 'download-tracker-line' });
	const marks = new Map<string, Element[]>();
	const yAxis = frame.createDiv({ cls: 'download-tracker-line-y' });
	const plot = frame.createDiv({ cls: 'download-tracker-line-plot' });
	for (const tick of ticks) {
		yAxis.createSpan({ text: formatCount(tick) }).style.top = `${y(tick)}%`;
		plot.createDiv({ cls: 'download-tracker-gridline' }).style.top = `${y(tick)}%`;
	}

	const svg = plot.createSvg('svg', {
		attr: { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
		cls: 'download-tracker-line-svg',
	});
	for (const s of series) {
		const own: Element[] = [];
		const coords = s.points.map((p) => `${x(p.time)},${y(p.value)}`);
		// A wash under one line helps; under several lines the washes stack into noise.
		if (series.length === 1 && s.points.length > 0) {
			const left = x(s.points[0]?.time ?? first);
			const right = x(s.points[s.points.length - 1]?.time ?? lastTime);
			own.push(
				svg.createSvg('polygon', {
					attr: { points: `${left},100 ${coords.join(' ')} ${right},100` },
					cls: ['download-tracker-line-area', s.cls],
				}),
			);
		}
		own.push(svg.createSvg('polyline', { attr: { points: coords.join(' ') }, cls: ['download-tracker-line-stroke', s.cls] }));
		for (const p of s.points) {
			const dot = plot.createDiv({ cls: `download-tracker-line-dot ${s.cls}` });
			dot.style.left = `${x(p.time)}%`;
			dot.style.top = `${y(p.value)}%`;
			own.push(dot);
		}
		marks.set(s.id, own);
	}

	// One hit column per date, so the pointer only has to find the date, not a line.
	all.forEach((t, i) => {
		const hit = plot.createDiv({ cls: 'download-tracker-line-hit' });
		hit.style.left = `${x(t)}%`;
		const parts = series
			.map((s) => ({ label: s.label, value: s.points.find((p) => p.time === t)?.value }))
			.filter((p): p is { label: string; value: number } => p.value !== undefined)
			.sort((a, b) => b.value - a.value)
			.map((p) => `${p.label} ${formatCount(p.value)}`);
		focusable(hit, `${pointLabel(t, i)}: ${parts.join(', ')}`);
	});

	// End values only where they don't collide; the legend and tooltip carry the rest.
	const endLabels = frame.createDiv({ cls: 'download-tracker-line-ends' });
	const placed: number[] = [];
	const lasts = series
		.map((s) => s.points[s.points.length - 1])
		.filter((p): p is { time: number; value: number } => p !== undefined && p.time === lastTime)
		.sort((a, b) => b.value - a.value);
	for (const last of lasts) {
		const top = y(last.value);
		if (placed.some((p) => Math.abs(p - top) < 9)) continue;
		placed.push(top);
		endLabels.createSpan({ text: formatCount(last.value), cls: 'download-tracker-line-end' }).style.top = `${top}%`;
	}

	if (periods) {
		// Label every period that fits: up to ten on a wide pane, three on a narrow one.
		const xAxis = frame.createDiv({ cls: 'download-tracker-line-x is-periods' });
		const wide = Math.ceil(all.length / 10);
		const narrow = Math.ceil(all.length / 3);
		all.forEach((t, i) => {
			const lastOne = i === all.length - 1;
			const showWide = lastOne || (i % wide === 0 && all.length - 1 - i >= wide / 2);
			if (!showWide) return;
			const showNarrow = lastOne || (i % narrow === 0 && all.length - 1 - i >= narrow / 2);
			const label = xAxis.createSpan({ text: axisLabel(t, i), cls: showNarrow ? '' : 'is-wide-only' });
			label.style.left = `${x(t)}%`;
		});
	} else {
		const sameDay = date(first) === date(lastTime);
		const xAxis = frame.createDiv({ cls: 'download-tracker-line-x' });
		xAxis.createSpan({ text: date(first, sameDay) });
		xAxis.createSpan({ text: date(lastTime, sameDay) });
	}

	if (series.length > 1) legend(parent, series, 'box', frame, marks);
}
