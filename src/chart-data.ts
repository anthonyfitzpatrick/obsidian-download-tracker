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
// narrowing the view never repaints a line. Past eight, the smallest share one
// grey "Other" line, because a ninth colour can't be told apart.
export function projectSeries(snapshots: Snapshot[], filter: ChartFilter, current: Current): Series[] {
	const group = current.rows
		.filter((r) => (filter.kind === 'repo' ? r.kind === 'repo' : r.kind !== 'repo'))
		.sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1) || a.name.localeCompare(b.name));
	const slot = new Map(group.map((r, i) => [rowKey(r), i < SLOTS - (group.length > SLOTS ? 1 : 0) ? i + 1 : 0]));
	const shown = group.filter((r) => kindMatches(r.kind, filter.kind) && nameMatches(r.name, filter.query));
	const ordered = [...snapshots].sort((a, b) => a.fetchedAt - b.fetchedAt);

	const pointsFor = (keys: string[]): Point[] => {
		const points: Point[] = [];
		for (const s of ordered) {
			const values = keys.map((k) => s.counts[k]).filter((v): v is number => v !== undefined);
			if (values.length > 0) points.push({ time: s.fetchedAt, value: values.reduce((a, b) => a + b, 0) });
		}
		const now = shown.filter((r) => keys.includes(rowKey(r)) && r.downloads !== null);
		if (now.length > 0) points.push({ time: current.time, value: now.reduce((a, r) => a + (r.downloads ?? 0), 0) });
		return points;
	};

	const series: Series[] = [];
	const others: string[] = [];
	for (const r of shown) {
		const n = slot.get(rowKey(r)) ?? 0;
		if (n === 0) others.push(rowKey(r));
		else series.push({ id: rowKey(r), label: r.name, cls: `is-slot-${n}`, points: pointsFor([rowKey(r)]) });
	}
	if (others.length > 0) {
		series.push({ id: 'other', label: `Other (${others.length})`, cls: 'is-total', points: pointsFor(others) });
	}
	return series.filter((s) => s.points.length > 0);
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
