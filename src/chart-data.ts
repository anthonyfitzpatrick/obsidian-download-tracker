import { Kind, Row, Snapshot, VersionCount, compareVersions, rowKey } from './counts';

export interface Point {
	time: number;
	value: number;
}

export type KindFilter = 'all' | Kind;

export interface ChartFilter {
	kind: KindFilter;
	query: string;
}

// "All" means plugins and themes: release-file counts of other repositories mean something else.
export function kindMatches(kind: Kind, filter: KindFilter): boolean {
	return filter === 'all' ? kind !== 'repo' : kind === filter;
}

export function nameMatches(name: string, query: string): boolean {
	const q = query.trim().toLowerCase();
	return q === '' || name.toLowerCase().includes(q);
}

export function historyPoints(snapshots: Snapshot[], filter: ChartFilter = { kind: 'all', query: '' }): Point[] {
	return [...snapshots]
		.sort((a, b) => a.fetchedAt - b.fetchedAt)
		.map((s) => ({
			time: s.fetchedAt,
			value: Object.entries(s.counts).reduce((sum, [key, v]) => {
				const kind = key.slice(0, key.indexOf(':')) as Kind;
				const name = s.names[key] ?? key;
				return kindMatches(kind, filter.kind) && nameMatches(name, filter.query) ? sum + v : sum;
			}, 0),
		}));
}

export interface Series {
	id: string;
	label: string;
	cls: string;
	points: Point[];
}

export interface Current {
	time: number;
	rows: Row[];
}

const SLOTS = 8;

function currentTotal(current: Current, kind: KindFilter, query: string): number {
	return current.rows
		.filter((r) => r.downloads !== null && kindMatches(r.kind, kind) && nameMatches(r.name, query))
		.reduce((sum, r) => sum + (r.downloads ?? 0), 0);
}

// With "All", plugins and themes get a line each plus their combined total.
// Any other filter draws one line. Series with no data in any snapshot are left out.
// The current, unsaved counts are the last point of every line, so lines
// start as soon as one snapshot exists.
export function historySeries(snapshots: Snapshot[], filter: ChartFilter, current?: Current): Series[] {
	const line = (kind: KindFilter): Point[] => {
		const points = historyPoints(snapshots, { kind, query: filter.query });
		if (current) points.push({ time: current.time, value: currentTotal(current, kind, filter.query) });
		return points;
	};
	const has = (kind: Kind) =>
		snapshots.some((s) =>
			Object.keys(s.counts).some((k) => k.startsWith(kind + ':') && nameMatches(s.names[k] ?? k, filter.query)),
		) || (current?.rows.some((r) => r.kind === kind && r.downloads !== null && nameMatches(r.name, filter.query)) ?? false);
	if (filter.kind !== 'all') {
		const labels: Record<Kind, string> = { plugin: 'Plugins', theme: 'Themes', repo: 'Other repositories' };
		return has(filter.kind)
			? [{ id: filter.kind, label: labels[filter.kind], cls: `is-${filter.kind}`, points: line(filter.kind) }]
			: [];
	}
	const series: Series[] = [];
	const kinds = (['plugin', 'theme'] as const).filter(has);
	if (kinds.length > 1) series.push({ id: 'total', label: 'Plugins and themes', cls: 'is-total', points: line('all') });
	if (kinds.includes('plugin')) series.push({ id: 'plugin', label: 'Plugins', cls: 'is-plugin', points: line('plugin') });
	if (kinds.includes('theme')) series.push({ id: 'theme', label: 'Themes', cls: 'is-theme', points: line('theme') });
	return series;
}

// Colours follow the project, not the filter: slots are handed out over the whole
// group (plugins and themes together, or other repositories), largest first, so
// narrowing the view never repaints a project. Past eight, the smallest share one
// grey "Other", because a ninth colour can't be told apart.
export function projectSlots(rows: Row[], kind: KindFilter): Map<string, string> {
	const group = rows
		.filter((r) => (kind === 'repo' ? r.kind === 'repo' : r.kind !== 'repo'))
		.sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1) || a.name.localeCompare(b.name));
	const coloured = group.length > SLOTS ? SLOTS - 1 : SLOTS;
	return new Map(group.map((r, i) => [rowKey(r), i < coloured ? `is-slot-${i + 1}` : 'is-total']));
}

// One line per project. A release's downloads are added at its publish date,
// so each line steps up at every release and ends today at the project's total.
export function releaseSeries(rows: Row[], slots: Map<string, string>, now: number): Series[] {
	const series: Series[] = [];
	const others: Row[] = [];
	for (const r of rows) {
		if (!r.versions.some((v) => typeof v.published === 'number')) continue;
		const cls = slots.get(rowKey(r)) ?? 'is-total';
		if (cls === 'is-total') others.push(r);
		else series.push({ id: rowKey(r), label: r.name, cls, points: cumulative([r], now) });
	}
	if (others.length > 0) {
		series.push({ id: 'other', label: `Other (${others.length})`, cls: 'is-total', points: cumulative(others, now) });
	}
	return series;
}

function cumulative(rows: Row[], now: number): Point[] {
	const releases = rows
		.flatMap((r) => r.versions)
		.filter((v): v is VersionCount & { published: number } => typeof v.published === 'number')
		.sort((a, b) => a.published - b.published);
	const points: Point[] = [];
	let total = 0;
	for (const v of releases) {
		total += v.downloads;
		const last = points[points.length - 1];
		if (last && last.time === v.published) last.value = total;
		else points.push({ time: v.published, value: total });
	}
	const last = points[points.length - 1];
	if (last && last.time < now) points.push({ time: now, value: total });
	return points;
}

// Round tick steps (1, 2 or 5 times a power of ten) so axis labels read cleanly.
export function niceTicks(min: number, max: number, count = 4): number[] {
	if (max <= min) max = min + 1;
	const raw = (max - min) / count;
	const power = Math.pow(10, Math.floor(Math.log10(raw)));
	const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
	const ticks: number[] = [];
	let t = Math.floor(min / step) * step;
	for (;;) {
		ticks.push(Math.round(t * 1e6) / 1e6);
		if (t >= max) return ticks;
		t += step;
	}
}

export function versionsOldestFirst(versions: VersionCount[]): VersionCount[] {
	return [...versions].sort((a, b) => compareVersions(a.version, b.version));
}
