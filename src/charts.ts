import { setTooltip } from 'obsidian';
import { historyPoints, niceTicks, versionsOldestFirst } from './chart-data';
import { Kind, Row, Snapshot, delta, formatCount, formatDelta } from './counts';
import type { Report } from './fetch';

type DateFormatter = (time: number | null, withTime?: boolean) => string;

interface Bar {
	label: string;
	value: number;
	kind: Kind;
}

const KIND_NAMES: Record<Kind, string> = { plugin: 'Plugin', theme: 'Theme', repo: 'Repository' };

export function renderCharts(
	parent: HTMLElement,
	report: Report,
	snapshots: Snapshot[],
	previous: Snapshot | undefined,
	date: DateFormatter,
): void {
	const obsidianRows = [...report.plugins, ...report.themes];

	const counted = obsidianRows.filter((r) => r.downloads !== null);
	const projects = card(
		parent,
		'Downloads by project',
		'Each bar is one published plugin or theme, longest first. The number at the end of the bar is its download count.',
	);
	if (counted.length === 0) empty(projects, 'No download counts are available yet.');
	else {
		const kinds = [...new Set(counted.map((r) => r.kind))];
		if (kinds.length > 1) legend(projects, kinds);
		bars(projects, toBars(counted));
	}

	const history = card(
		parent,
		'Downloads over time',
		'The line joins the plugin and theme total of each saved snapshot. Save snapshots regularly to see the trend.',
	);
	const points = historyPoints(snapshots);
	if (points.length < 2) {
		empty(
			history,
			`This needs at least two snapshots. You have ${points.length}. Use Save snapshot after refreshing on different days.`,
		);
	} else line(history, points, date);

	if (previous) {
		const changes = obsidianRows
			.map((r) => ({ row: r, change: delta(r, previous) }))
			.filter((c): c is { row: Row; change: number } => c.change !== null);
		const since = card(
			parent,
			'Downloads since the last snapshot',
			`Change since the snapshot from ${date(previous.fetchedAt, true)}. Bars to the right are new downloads; a bar to the left means the count went down, which happens when it now comes from a source that lags.`,
		);
		if (changes.length === 0) empty(since, 'No counts can be compared with that snapshot.');
		else changeBars(since, changes);
	}

	const withVersions = report.plugins.filter((p) => p.versions.length > 1);
	if (withVersions.length > 0) {
		const versions = card(
			parent,
			'Downloads by version',
			'One small chart per plugin, oldest version on the left. Each chart has its own scale, so compare shapes rather than heights between charts. The tallest column is labelled.',
		);
		const grid = versions.createDiv({ cls: 'download-tracker-multiples' });
		for (const p of withVersions) versionColumns(grid, p);
	}

	const repos = report.repos.filter((r) => r.downloads !== null && r.downloads > 0);
	if (repos.length > 0) {
		const other = card(
			parent,
			'Other repositories',
			'Downloads of every file attached to each repository’s GitHub releases. These are counted differently from plugin and theme downloads, so they have their own chart.',
		);
		bars(other, toBars(repos));
	}
}

function toBars(rows: Row[]): Bar[] {
	return rows
		.map((r) => ({ label: r.name, value: r.downloads ?? 0, kind: r.kind }))
		.sort((a, b) => b.value - a.value);
}

function card(parent: HTMLElement, title: string, howTo: string): HTMLElement {
	const el = parent.createDiv({ cls: 'download-tracker-chart' });
	el.createEl('h4', { text: title });
	el.createEl('p', { text: `How to read this: ${howTo}`, cls: 'download-tracker-chart-help' });
	return el;
}

function empty(parent: HTMLElement, text: string): void {
	parent.createEl('p', { text, cls: 'download-tracker-empty' });
}

function legend(parent: HTMLElement, kinds: Kind[]): void {
	const el = parent.createDiv({ cls: 'download-tracker-legend' });
	for (const kind of kinds) {
		const item = el.createSpan({ cls: 'download-tracker-legend-item' });
		item.createSpan({ cls: `download-tracker-swatch is-${kind}` });
		item.createSpan({ text: KIND_NAMES[kind] });
	}
}

function focusable(el: HTMLElement, tip: string): void {
	el.tabIndex = 0;
	el.setAttr('aria-label', tip);
	setTooltip(el, tip);
}

function bars(parent: HTMLElement, items: Bar[]): void {
	const max = Math.max(...items.map((b) => b.value), 1);
	const list = parent.createDiv({ cls: 'download-tracker-bars' });
	for (const item of items) {
		const row = list.createDiv({ cls: 'download-tracker-bar-row' });
		focusable(row, `${item.label}: ${formatCount(item.value)} downloads`);
		row.createDiv({ text: item.label, cls: 'download-tracker-bar-label' });
		const track = row.createDiv({ cls: 'download-tracker-bar-track' });
		const bar = track.createDiv({ cls: `download-tracker-bar-fill is-${item.kind}` });
		bar.style.width = `${(item.value / max) * 100}%`;
		track.createSpan({ text: formatCount(item.value), cls: 'download-tracker-bar-value' });
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
		const bar = plot.createDiv({
			cls: `download-tracker-bar-fill ${change < 0 ? 'is-negative' : 'is-positive'}`,
		});
		bar.style.width = `${width}%`;
		track.createSpan({ text: formatDelta(change), cls: 'download-tracker-bar-value' });
	}
}

function versionColumns(parent: HTMLElement, plugin: Row): void {
	const versions = versionsOldestFirst(plugin.versions);
	const max = Math.max(...versions.map((v) => v.downloads), 1);
	const tallest = versions.reduce((a, b) => (b.downloads > a.downloads ? b : a));
	const el = parent.createDiv({ cls: 'download-tracker-multiple' });
	const title = el.createDiv({ text: plugin.name, cls: 'download-tracker-multiple-title' });
	setTooltip(title, plugin.name);
	const plot = el.createDiv({ cls: 'download-tracker-columns' });
	for (const v of versions) {
		const slot = plot.createDiv({ cls: 'download-tracker-column-slot' });
		focusable(slot, `${plugin.name} ${v.version}: ${formatCount(v.downloads)} downloads`);
		if (v === tallest) slot.createSpan({ text: formatCount(v.downloads), cls: 'download-tracker-column-value' });
		const column = slot.createDiv({ cls: 'download-tracker-column is-plugin' });
		column.style.height = `${(v.downloads / max) * 100}%`;
	}
	const axis = el.createDiv({ cls: 'download-tracker-columns-axis' });
	axis.createSpan({ text: versions[0]?.version ?? '' });
	axis.createSpan({ text: versions[versions.length - 1]?.version ?? '' });
}

function line(parent: HTMLElement, points: { time: number; value: number }[], date: DateFormatter): void {
	const values = points.map((p) => p.value);
	const ticks = niceTicks(Math.min(...values), Math.max(...values));
	const low = ticks[0] ?? 0;
	const high = ticks[ticks.length - 1] ?? 1;
	const first = points[0]?.time ?? 0;
	const span = Math.max((points[points.length - 1]?.time ?? 1) - first, 1);
	const x = (t: number) => ((t - first) / span) * 100;
	const y = (v: number) => 100 - ((v - low) / (high - low || 1)) * 100;

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
	const coords = points.map((p) => `${x(p.time)},${y(p.value)}`);
	svg.createSvg('polygon', {
		attr: { points: `0,100 ${coords.join(' ')} 100,100` },
		cls: 'download-tracker-line-area',
	});
	svg.createSvg('polyline', { attr: { points: coords.join(' ') }, cls: 'download-tracker-line-stroke' });

	points.forEach((p, i) => {
		const dot = plot.createDiv({ cls: 'download-tracker-line-dot' });
		dot.style.left = `${x(p.time)}%`;
		dot.style.top = `${y(p.value)}%`;
		focusable(dot, `${date(p.time, true)}: ${formatCount(p.value)} downloads`);
		if (i === points.length - 1) {
			dot.createSpan({ text: formatCount(p.value), cls: 'download-tracker-line-end' });
		}
	});

	const xAxis = frame.createDiv({ cls: 'download-tracker-line-x' });
	xAxis.createSpan({ text: date(first) });
	xAxis.createSpan({ text: date(points[points.length - 1]?.time ?? first) });
}
