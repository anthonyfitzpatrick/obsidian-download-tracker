import { setTooltip } from 'obsidian';
import {
	ChartFilter,
	Current,
	KindFilter,
	Series,
	historySeries,
	cumulativeStacks,
	projectSlots,
	Stacks,
	kindMatches,
	nameMatches,
	niceTicks,
	versionsOldestFirst,
} from './chart-data';
import { Row, Snapshot, delta, formatCount, formatDelta } from './counts';
import type { Report } from './fetch';

type DateFormatter = (time: number | null, withTime?: boolean) => string;

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
		drawCharts(body, all, snapshots, previous, date, filter, { time: report.fetchedAt, rows: all });
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
		'Cumulative, from the earliest publication to today. Each release’s downloads are added at the date it was published, so a column shows the downloads of every release out by then, not downloads made by then. Hover over a column for each project’s share.',
	);
	const slots = projectSlots(all, filter.kind);
	const stacks = cumulativeStacks(rows, slots, current.time);
	if (!stacks) empty(projects, 'None of these projects has dated releases with downloads.');
	else stackedColumns(projects, stacks, date);
	if (rows.some((r) => r.kind === 'theme')) {
		projects.createEl('p', {
			text: 'Themes aren’t in this chart: Obsidian publishes one total per theme, not a count per release.',
			cls: 'download-tracker-chart-note',
		});
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

function stackedColumns(parent: HTMLElement, data: Stacks, date: DateFormatter): void {
	const totals = data.ends.map((_, i) => data.stacks.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
	const ticks = niceTicks(0, Math.max(...totals, 1));
	const high = ticks[ticks.length - 1] ?? 1;
	const pct = (v: number) => (v / high) * 100;

	if (data.stacks.length > 1) legend(parent, data.stacks, 'box');
	const frame = parent.createDiv({ cls: 'download-tracker-stack' });
	const yAxis = frame.createDiv({ cls: 'download-tracker-line-y' });
	const plot = frame.createDiv({ cls: 'download-tracker-stack-plot' });
	for (const tick of ticks) {
		yAxis.createSpan({ text: formatCount(tick) }).style.top = `${100 - pct(tick)}%`;
		plot.createDiv({ cls: 'download-tracker-gridline' }).style.top = `${100 - pct(tick)}%`;
	}

	const label = (i: number) => {
		const end = data.ends[i] ?? 0;
		// Columns before the last cover up to their boundary, which is the start of the next period.
		return i === data.ends.length - 1 ? `${date(end)} (today)` : `Before ${date(end)}`;
	};
	const columns = plot.createDiv({ cls: 'download-tracker-stack-columns' });
	data.ends.forEach((_, i) => {
		const total = totals[i] ?? 0;
		const slot = columns.createDiv({ cls: 'download-tracker-stack-slot' });
		const parts = data.stacks
			.map((s) => ({ label: s.label, value: s.values[i] ?? 0 }))
			.filter((p) => p.value > 0)
			.sort((a, b) => b.value - a.value)
			.map((p) => `${p.label} ${formatCount(p.value)}`);
		focusable(slot, `${label(i)}: ${formatCount(total)} downloads${parts.length > 1 ? ` (${parts.join(', ')})` : ''}`);
		const column = slot.createDiv({ cls: 'download-tracker-stack-column' });
		column.style.height = `${pct(total)}%`;
		// Largest project at the base, so the biggest share sits on the baseline.
		for (const s of data.stacks) {
			const value = s.values[i] ?? 0;
			if (value <= 0 || total <= 0) continue;
			column.createDiv({ cls: `download-tracker-stack-part ${s.cls}` }).style.flexGrow = String(value);
		}
		if (i === data.ends.length - 1) slot.createSpan({ text: formatCount(total), cls: 'download-tracker-column-value' });
	});

	const xAxis = frame.createDiv({ cls: 'download-tracker-line-x' });
	const unit = { week: 'Weekly', month: 'Monthly', quarter: 'Quarterly' }[data.period];
	xAxis.createSpan({ text: date(data.start) });
	xAxis.createSpan({ text: `${unit} columns`, cls: 'download-tracker-stack-unit' });
	xAxis.createSpan({ text: date(data.ends[data.ends.length - 1] ?? 0) });
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

function lines(parent: HTMLElement, series: Series[], date: DateFormatter): void {
	const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.time)))].sort((a, b) => a - b);
	const values = series.flatMap((s) => s.points.map((p) => p.value));
	const ticks = niceTicks(Math.min(...values), Math.max(...values));
	const low = ticks[0] ?? 0;
	const high = ticks[ticks.length - 1] ?? 1;
	const first = times[0] ?? 0;
	const span = Math.max((times[times.length - 1] ?? 1) - first, 1);
	const x = (t: number) => ((t - first) / span) * 100;
	const y = (v: number) => 100 - ((v - low) / (high - low || 1)) * 100;

	const frame = parent.createDiv({ cls: 'download-tracker-line' });
	const marks = new Map<string, Element[]>();
	if (series.length > 1) legend(parent, series, 'line', frame, marks);
	parent.appendChild(frame);
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
		if (series.length === 1) {
			own.push(
				svg.createSvg('polygon', {
					attr: { points: `0,100 ${coords.join(' ')} 100,100` },
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
	for (const t of times) {
		const hit = plot.createDiv({ cls: 'download-tracker-line-hit' });
		hit.style.left = `${x(t)}%`;
		const parts = series
			.map((s) => ({ label: s.label, value: s.points.find((p) => p.time === t)?.value }))
			.filter((p): p is { label: string; value: number } => p.value !== undefined)
			.sort((a, b) => b.value - a.value)
			.map((p) => `${p.label} ${formatCount(p.value)}`);
		focusable(hit, `${date(t, true)}: ${parts.join(', ')}`);
	}

	// End values only where they don't collide; the legend and tooltip carry the rest.
	const ends = frame.createDiv({ cls: 'download-tracker-line-ends' });
	const placed: number[] = [];
	const lasts = series
		.map((s) => s.points[s.points.length - 1])
		.filter((p): p is { time: number; value: number } => p !== undefined)
		.sort((a, b) => b.value - a.value);
	for (const last of lasts) {
		const top = y(last.value);
		if (placed.some((p) => Math.abs(p - top) < 9)) continue;
		placed.push(top);
		ends.createSpan({ text: formatCount(last.value), cls: 'download-tracker-line-end' }).style.top = `${top}%`;
	}

	const last = times[times.length - 1] ?? first;
	const sameDay = date(first) === date(last);
	const xAxis = frame.createDiv({ cls: 'download-tracker-line-x' });
	xAxis.createSpan({ text: date(first, sameDay) });
	xAxis.createSpan({ text: date(last, sameDay) });
}
