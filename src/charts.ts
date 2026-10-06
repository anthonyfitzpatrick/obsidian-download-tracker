import { setTooltip } from 'obsidian';
import {
	ChartFilter,
	KindFilter,
	Series,
	historySeries,
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

const BAR_LEGEND: Record<string, string> = { plugin: 'Plugin', theme: 'Theme' };

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
		drawCharts(body, all, snapshots, previous, date, filter);
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
): void {
	const rows = all.filter((r) => kindMatches(r.kind, filter.kind) && nameMatches(r.name, filter.query));
	if (rows.length === 0) {
		empty(parent, 'Nothing matches this filter.');
		return;
	}
	const repos = filter.kind === 'repo';

	const counted = rows.filter((r) => r.downloads !== null);
	const totals = card(
		parent,
		repos ? 'Release-file downloads' : 'Downloads by project',
		repos
			? 'Every file attached to each GitHub release counts, so these numbers are not comparable with plugin and theme downloads.'
			: 'Longest bar first. The number is the download count.',
	);
	if (counted.length === 0) empty(totals, 'No download counts are available.');
	else {
		const kinds = [...new Set(counted.map((r) => r.kind))].filter((k) => k in BAR_LEGEND);
		if (kinds.length > 1) legend(totals, kinds.map((k) => ({ id: k, label: BAR_LEGEND[k] ?? k })), 'box');
		bars(totals, counted);
	}

	const history = card(
		parent,
		'Downloads over time',
		'Each point is a saved snapshot. Hover over or tab to a date to see every line’s value.',
	);
	const series = historySeries(snapshots, filter);
	if (series.length === 0) empty(history, 'No saved snapshot includes these projects yet.');
	else if (snapshots.length < 2) empty(history, `Needs two snapshots. You have ${snapshots.length}.`);
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

function legend(parent: HTMLElement, items: { id: string; label: string }[], key: 'box' | 'line'): void {
	const el = parent.createDiv({ cls: 'download-tracker-legend' });
	for (const item of items) {
		const entry = el.createSpan({ cls: 'download-tracker-legend-item' });
		entry.createSpan({ cls: `download-tracker-swatch is-${item.id} is-${key}` });
		entry.createSpan({ text: item.label });
	}
}

function focusable(el: HTMLElement, tip: string): void {
	el.tabIndex = 0;
	el.setAttr('aria-label', tip);
	setTooltip(el, tip);
}

function bars(parent: HTMLElement, rows: Row[]): void {
	const sorted = [...rows].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
	const max = Math.max(...sorted.map((r) => r.downloads ?? 0), 1);
	const list = parent.createDiv({ cls: 'download-tracker-bars' });
	for (const r of sorted) {
		const value = r.downloads ?? 0;
		const row = list.createDiv({ cls: 'download-tracker-bar-row' });
		focusable(row, `${r.name}: ${formatCount(value)} downloads`);
		row.createDiv({ text: r.name, cls: 'download-tracker-bar-label' });
		const track = row.createDiv({ cls: 'download-tracker-bar-track' });
		track.createDiv({ cls: `download-tracker-bar-fill is-${r.kind}` }).style.width = `${(value / max) * 100}%`;
		track.createSpan({ text: formatCount(value), cls: 'download-tracker-bar-value' });
	}
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
	const times = series[0]?.points.map((p) => p.time) ?? [];
	const values = series.flatMap((s) => s.points.map((p) => p.value));
	const ticks = niceTicks(Math.min(...values), Math.max(...values));
	const low = ticks[0] ?? 0;
	const high = ticks[ticks.length - 1] ?? 1;
	const first = times[0] ?? 0;
	const span = Math.max((times[times.length - 1] ?? 1) - first, 1);
	const x = (t: number) => ((t - first) / span) * 100;
	const y = (v: number) => 100 - ((v - low) / (high - low || 1)) * 100;

	if (series.length > 1) legend(parent, series, 'line');
	const frame = parent.createDiv({ cls: 'download-tracker-line' });
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
		const coords = s.points.map((p) => `${x(p.time)},${y(p.value)}`);
		// A wash under one line helps; under several lines the washes stack into noise.
		if (series.length === 1) {
			svg.createSvg('polygon', {
				attr: { points: `0,100 ${coords.join(' ')} 100,100` },
				cls: ['download-tracker-line-area', `is-${s.id}`],
			});
		}
		svg.createSvg('polyline', { attr: { points: coords.join(' ') }, cls: ['download-tracker-line-stroke', `is-${s.id}`] });
		for (const p of s.points) {
			const dot = plot.createDiv({ cls: `download-tracker-line-dot is-${s.id}` });
			dot.style.left = `${x(p.time)}%`;
			dot.style.top = `${y(p.value)}%`;
		}
	}

	// One hit column per snapshot, so the pointer only has to find the date, not a line.
	times.forEach((t, i) => {
		const hit = plot.createDiv({ cls: 'download-tracker-line-hit' });
		hit.style.left = `${x(t)}%`;
		const parts = series.map((s) => `${s.label} ${formatCount(s.points[i]?.value ?? null)}`);
		focusable(hit, `${date(t, true)}: ${parts.join(', ')}`);
	});

	const ends = frame.createDiv({ cls: 'download-tracker-line-ends' });
	for (const s of series) {
		const last = s.points[s.points.length - 1];
		if (!last) continue;
		ends.createSpan({ text: formatCount(last.value), cls: 'download-tracker-line-end' }).style.top = `${y(last.value)}%`;
	}

	const xAxis = frame.createDiv({ cls: 'download-tracker-line-x' });
	xAxis.createSpan({ text: date(first) });
	xAxis.createSpan({ text: date(times[times.length - 1] ?? first) });
}
