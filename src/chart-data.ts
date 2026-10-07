import { Kind, Row, Snapshot, rowKey } from './counts';

export interface Point {
	time: number;
	value: number;
	estimated?: boolean;
}

export type KindFilter = 'all' | Kind;

export type Range = 'week' | 'month' | 'quarter' | 'year' | 'all';

export const RANGES: { range: Range; label: string }[] = [
	{ range: 'week', label: 'Last 7 days' },
	{ range: 'month', label: 'Last month' },
	{ range: 'quarter', label: 'Last quarter' },
	{ range: 'year', label: 'Last year' },
	{ range: 'all', label: 'All time' },
];

export interface ChartFilter {
	kind: KindFilter;
	query: string;
	range: Range;
}

// "All" means plugins and themes: release-file counts of other repositories mean something else.
export function kindMatches(kind: Kind, filter: KindFilter): boolean {
	return filter === 'all' ? kind !== 'repo' : kind === filter;
}

export function nameMatches(name: string, query: string): boolean {
	const q = query.trim().toLowerCase();
	return q === '' || name.toLowerCase().includes(q);
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

export type Period = 'day' | 'week' | 'month' | 'quarter';

// Period boundaries from the earliest publication to now: weekly for up to four
// months, monthly for up to two years, quarterly beyond. The last period ends now.
export function periodEnds(first: number, now: number): { ends: number[]; period: Period } {
	const days = (now - first) / 86_400_000;
	const period: Period = days <= 120 ? 'week' : days <= 730 ? 'month' : 'quarter';
	const ends: number[] = [];
	const start = new Date(first);
	if (period === 'week') {
		const base = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
		for (let t = base + 7 * 86_400_000; t < now; t += 7 * 86_400_000) ends.push(t);
	} else {
		const step = period === 'month' ? 1 : 3;
		const firstMonth = period === 'month' ? start.getMonth() : start.getMonth() - (start.getMonth() % 3);
		for (let m = firstMonth + step; ; m += step) {
			const t = new Date(start.getFullYear(), m, 1).getTime();
			if (t >= now) break;
			ends.push(t);
		}
	}
	ends.push(now);
	return { ends, period };
}

const DAY = 86_400_000;

function dayEnds(start: number, now: number, step: number): number[] {
	const s = new Date(start);
	const ends: number[] = [];
	for (let t = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime() + step * DAY; t < now; t += step * DAY) {
		ends.push(t);
	}
	return ends;
}

// The chart's points for a range: daily for the last 7 days, every 3 days for the
// last month, weekly for the last quarter, monthly for the last year. A range that
// reaches back before the first release starts at the first release instead.
export function rangeEnds(range: Range, first: number, now: number): { start: number; ends: number[]; period: Period } {
	if (range === 'all') return { start: first, ...periodEnds(first, now) };
	const back = new Date(now);
	const from =
		range === 'week'
			? now - 7 * DAY
			: range === 'month'
				? new Date(back.getFullYear(), back.getMonth() - 1, back.getDate()).getTime()
				: range === 'quarter'
					? new Date(back.getFullYear(), back.getMonth() - 3, back.getDate()).getTime()
					: new Date(back.getFullYear() - 1, back.getMonth(), back.getDate()).getTime();
	const start = Math.max(from, first);
	if (range === 'year') {
		const s = new Date(start);
		const ends: number[] = [];
		for (let m = s.getMonth() + 1; ; m++) {
			const t = new Date(s.getFullYear(), m, 1).getTime();
			if (t >= now) break;
			ends.push(t);
		}
		return { start, ends: [...ends, now], period: 'month' };
	}
	const step = range === 'week' ? 1 : range === 'month' ? 3 : 7;
	return { start, ends: [...dayEnds(start, now, step), now], period: range === 'quarter' ? 'week' : 'day' };
}

// Obsidian's plugin stats file as it stood at a period end, keyed by that time.
// `ids` records which plugins were looked up, so a plugin added later is fetched again.
export interface DailyFigures {
	ids: string[];
	counts: Record<string, number>;
}
export type FiguresCache = Record<string, DailyFigures>;

export function earliestRelease(rows: Row[]): number | null {
	const times = rows.flatMap((r) => r.versions.map((v) => v.published).filter((t): t is number => typeof t === 'number'));
	return times.length > 0 ? Math.min(...times) : null;
}

export function missingFigures(ends: number[], ids: string[], cache: FiguresCache): number[] {
	return ends.filter((end) => {
		const entry = cache[String(end)];
		return !entry || ids.some((id) => !entry.ids.includes(id));
	});
}

// What is known about a project at a period end: its total, a zero because it wasn't
// out yet, or nothing (null) when no source covers that date. Plugins use Obsidian's
// daily figures; themes and other repositories only have saved snapshots. The last
// period is today, which uses the count from the tables.
interface Known {
	value: number;
	started: boolean;
	estimated: boolean;
}

function knownAt(
	r: Row,
	end: number,
	now: number,
	isLast: boolean,
	figures: FiguresCache,
	ordered: Snapshot[],
): Known | null {
	if (isLast) return r.downloads === null ? null : { value: r.downloads, started: true, estimated: false };
	const first = earliestRelease([r]);
	if (first !== null && end <= first) return { value: 0, started: false, estimated: false };
	if (r.kind === 'plugin') {
		const entry = figures[String(end)];
		if (entry?.ids.includes(r.id)) {
			const n = entry.counts[r.id];
			// Missing from the file means not yet in Obsidian's directory.
			return n === undefined ? { value: 0, started: false, estimated: false } : { value: n, started: true, estimated: false };
		}
		// Not loaded yet: wait for the real figure rather than estimate.
		return null;
	}
	const key = rowKey(r);
	const saved = ordered.filter((s) => s.fetchedAt <= end && s.counts[key] !== undefined).pop();
	const value = saved?.counts[key];
	if (value !== undefined) return { value, started: true, estimated: false };
	// No record for themes and other repositories before the first snapshot: estimate a
	// straight rise from zero at the first release to the first recorded value.
	if (first === null) return null;
	const next = ordered.find((s) => s.fetchedAt > end && s.counts[key] !== undefined);
	const target = next ? { time: next.fetchedAt, value: next.counts[key] ?? 0 } : { time: now, value: r.downloads ?? 0 };
	if (target.time <= first) return null;
	const share = (end - first) / (target.time - first);
	return { value: Math.round(target.value * share), started: true, estimated: true };
}

// A point only where every project in the group is known, so a sum never leaves
// anything out; a line breaks where it can't be drawn truthfully. Periods before a
// project was out are left off its line, unless `fromZero` asks for them: gains need
// that zero as the starting point of the first period.
function groupLine(
	group: Row[],
	ends: number[],
	figures: FiguresCache,
	snapshots: Snapshot[],
	fromZero = false,
): Point[] {
	const ordered = [...snapshots].sort((a, b) => a.fetchedAt - b.fetchedAt);
	const points: Point[] = [];
	const now = ends[ends.length - 1] ?? 0;
	ends.forEach((end, i) => {
		const known = group.map((r) => knownAt(r, end, now, i === ends.length - 1, figures, ordered));
		if (known.some((k) => k === null) || (!fromZero && !known.some((k) => k?.started))) return;
		const point: Point = { time: end, value: known.reduce((sum, k) => sum + (k?.value ?? 0), 0) };
		if (known.some((k) => k?.estimated)) point.estimated = true;
		points.push(point);
	});
	return points;
}

// One line per project, with a point at the end of every period.
export function periodSeries(
	rows: Row[],
	slots: Map<string, string>,
	ends: number[],
	figures: FiguresCache,
	snapshots: Snapshot[],
	fromZero = false,
): Series[] {
	const series: Series[] = [];
	const others: Row[] = [];
	for (const r of rows) {
		const cls = slots.get(rowKey(r)) ?? 'is-total';
		if (cls === 'is-total') others.push(r);
		else series.push({ id: rowKey(r), label: r.name, cls, points: groupLine([r], ends, figures, snapshots, fromZero) });
	}
	if (others.length > 0) {
		series.push({
			id: 'other',
			label: `Other (${others.length})`,
			cls: 'is-total',
			points: groupLine(others, ends, figures, snapshots, fromZero),
		});
	}
	return series.filter((s) => s.points.length > 0);
}

// With "All", plugins and themes get a line each plus their combined total; any
// other filter draws one line. Same periods and sources as periodSeries.
export function periodTotals(
	rows: Row[],
	kind: KindFilter,
	ends: number[],
	figures: FiguresCache,
	snapshots: Snapshot[],
): Series[] {
	const of = (k: Kind) => rows.filter((r) => r.kind === k);
	const make = (id: string, label: string, cls: string, group: Row[]): Series => ({
		id,
		label,
		cls,
		points: groupLine(group, ends, figures, snapshots),
	});
	const series: Series[] = [];
	if (kind === 'all') {
		const plugins = of('plugin');
		const themes = of('theme');
		if (plugins.length > 0 && themes.length > 0) series.push(make('total', 'Plugins and themes', 'is-total', [...plugins, ...themes]));
		if (plugins.length > 0) series.push(make('plugin', 'Plugins', 'is-plugin', plugins));
		if (themes.length > 0) series.push(make('theme', 'Themes', 'is-theme', themes));
	} else {
		const labels: Record<Kind, string> = { plugin: 'Plugins', theme: 'Themes', repo: 'Other repositories' };
		if (of(kind).length > 0) series.push(make(kind, labels[kind], `is-${kind}`, of(kind)));
	}
	return series.filter((s) => s.points.length > 0);
}

// Downloads gained in each period, from the running totals. Only complete periods:
// the last one is still running, and its total is GitHub's live count while the
// others are Obsidian's figures, which lag, so including it would show a false jump.
// A gain needs both ends recorded and next to each other; estimates give none.
export function gainSeries(series: Series[], ends: number[]): Series[] {
	const index = new Map(ends.map((t, i) => [t, i]));
	const lastEnd = ends[ends.length - 1];
	return series
		.map((s) => {
			const points: Point[] = [];
			s.points.forEach((p, i) => {
				const prev = s.points[i - 1];
				if (!prev || p.time === lastEnd || p.estimated || prev.estimated) return;
				// Zero to zero only happens before a project is out; it isn't a gain to plot.
				if (prev.value === 0 && p.value === 0) return;
				if ((index.get(p.time) ?? 0) - (index.get(prev.time) ?? 0) !== 1) return;
				points.push({ time: p.time, value: p.value - prev.value });
			});
			return { ...s, points };
		})
		.filter((s) => s.points.length > 0);
}

export interface Release {
	time: number;
	project: string;
	version: string;
	cls: string;
	id: string;
}

// Published releases of the shown projects inside the range, oldest first.
export function releasesIn(rows: Row[], slots: Map<string, string>, start: number, now: number): Release[] {
	return rows
		.flatMap((r) =>
			r.versions
				.filter((v): v is typeof v & { published: number } => typeof v.published === 'number')
				.filter((v) => v.published >= start && v.published <= now)
				.map((v) => {
					const cls = slots.get(rowKey(r)) ?? 'is-total';
					return { time: v.published, project: r.name, version: v.version, cls, id: cls === 'is-total' ? 'other' : rowKey(r) };
				}),
		)
		.sort((a, b) => a.time - b.time);
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
