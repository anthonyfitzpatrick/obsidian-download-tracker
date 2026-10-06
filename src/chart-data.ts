import { Kind, Snapshot, VersionCount, compareVersions } from './counts';

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
	id: 'total' | Kind;
	label: string;
	points: Point[];
}

// With "All", plugins and themes get a line each plus their combined total.
// Any other filter draws one line. Series with no data in any snapshot are left out.
export function historySeries(snapshots: Snapshot[], filter: ChartFilter): Series[] {
	const line = (kind: KindFilter) => historyPoints(snapshots, { kind, query: filter.query });
	const has = (kind: Kind) =>
		snapshots.some((s) =>
			Object.keys(s.counts).some((k) => k.startsWith(kind + ':') && nameMatches(s.names[k] ?? k, filter.query)),
		);
	if (filter.kind !== 'all') {
		const labels: Record<Kind, string> = { plugin: 'Plugins', theme: 'Themes', repo: 'Other repositories' };
		return has(filter.kind) ? [{ id: filter.kind, label: labels[filter.kind], points: line(filter.kind) }] : [];
	}
	const series: Series[] = [];
	const kinds = (['plugin', 'theme'] as const).filter(has);
	if (kinds.length > 1) series.push({ id: 'total', label: 'Plugins and themes', points: line('all') });
	if (kinds.includes('plugin')) series.push({ id: 'plugin', label: 'Plugins', points: line('plugin') });
	if (kinds.includes('theme')) series.push({ id: 'theme', label: 'Themes', points: line('theme') });
	return series;
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
