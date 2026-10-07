import { describe, expect, it } from 'vitest';
import { historyPoints, historySeries, kindMatches, nameMatches, niceTicks, missingFigures, periodEnds, periodSeries, projectSlots } from '../src/chart-data';
import type { FiguresCache } from '../src/chart-data';
import type { Row, Snapshot } from '../src/counts';

function row(kind: Row['kind'], id: string, name: string, downloads: number | null): Row {
	return { kind, name, id, repo: `me/${id}`, downloads, source: 'live', versions: [], stars: null, firstRelease: null, lastUpdated: null, visibility: null, openIssues: null, openPulls: null };
}

describe('historyPoints', () => {
	it('totals plugins and themes per snapshot in time order', () => {
		const points = historyPoints([
			{ fetchedAt: 2000, counts: { 'plugin:a': 12, 'theme:t': 5, 'repo:r': 900 }, names: {} },
			{ fetchedAt: 1000, counts: { 'plugin:a': 10 }, names: {} },
		]);
		expect(points).toEqual([
			{ time: 1000, value: 10 },
			{ time: 2000, value: 17 },
		]);
	});
});

const snaps: Snapshot[] = [
	{ fetchedAt: 1000, counts: { 'plugin:a': 10, 'theme:t': 4, 'repo:r': 50 }, names: { 'plugin:a': 'Alpha', 'theme:t': 'Tango', 'repo:r': 'Romeo' } },
	{ fetchedAt: 2000, counts: { 'plugin:a': 12, 'theme:t': 5, 'repo:r': 60 }, names: { 'plugin:a': 'Alpha', 'theme:t': 'Tango', 'repo:r': 'Romeo' } },
];

describe('filters', () => {
	it('treats All as plugins and themes, and matches names case-insensitively', () => {
		expect(kindMatches('plugin', 'all')).toBe(true);
		expect(kindMatches('repo', 'all')).toBe(false);
		expect(kindMatches('repo', 'repo')).toBe(true);
		expect(nameMatches('Metadata Visuals', ' visu ')).toBe(true);
		expect(nameMatches('Metadata Visuals', 'amiga')).toBe(false);
	});

	it('totals only matching projects', () => {
		expect(historyPoints(snaps, { kind: 'all', query: 'tan' }).map((p) => p.value)).toEqual([4, 5]);
		expect(historyPoints(snaps, { kind: 'repo', query: '' }).map((p) => p.value)).toEqual([50, 60]);
	});
});

describe('historySeries', () => {
	it('draws plugins, themes and their total for All', () => {
		const series = historySeries(snaps, { kind: 'all', query: '' });
		expect(series.map((s) => [s.id, s.cls, s.points.map((p) => p.value)])).toEqual([
			['total', 'is-total', [14, 17]],
			['plugin', 'is-plugin', [10, 12]],
			['theme', 'is-theme', [4, 5]],
		]);
	});

	it('draws one line for a single type, and drops a total that would equal its only part', () => {
		expect(historySeries(snaps, { kind: 'theme', query: '' }).map((s) => s.id)).toEqual(['theme']);
		expect(historySeries(snaps, { kind: 'all', query: 'alpha' }).map((s) => s.id)).toEqual(['plugin']);
		expect(historySeries(snaps, { kind: 'all', query: 'nothing' })).toEqual([]);
	});
});

describe('historySeries with current counts', () => {
	it('ends every line with the unsaved counts', () => {
		const current = { time: 3000, rows: [row('plugin', 'a', 'Alpha', 20), row('theme', 't', 'Tango', 6)] };
		const series = historySeries(snaps, { kind: 'all', query: '' }, current);
		expect(series.map((s) => s.points.map((p) => p.value))).toEqual([
			[14, 17, 26],
			[10, 12, 20],
			[4, 5, 6],
		]);
	});
});

describe('projectSlots', () => {
	const rows = [row('plugin', 'a', 'Alpha', 20), row('theme', 't', 'Tango', 60), row('repo', 'r', 'Romeo', 70)];

	it('colours plugins and themes together, largest first, whatever the filter', () => {
		const all = projectSlots(rows, 'all');
		expect([...all.entries()]).toEqual([
			['theme:t', 'is-slot-1'],
			['plugin:a', 'is-slot-2'],
		]);
		expect(projectSlots(rows, 'plugin').get('plugin:a')).toBe('is-slot-2');
	});

	it('folds projects past eight into Other', () => {
		const many = Array.from({ length: 10 }, (_, i) => row('plugin', `p${i}`, `P${i}`, 100 - i));
		const slots = projectSlots(many, 'all');
		expect(slots.get('plugin:p6')).toBe('is-slot-7');
		expect(slots.get('plugin:p7')).toBe('is-total');
	});
});

describe('periodEnds', () => {
	it('uses weeks for short spans and ends at now', () => {
		const first = new Date(2026, 6, 4, 21, 0).getTime();
		const now = new Date(2026, 6, 20, 12, 0).getTime();
		const { ends, period } = periodEnds(first, now);
		expect(period).toBe('week');
		expect(ends).toEqual([new Date(2026, 6, 11).getTime(), new Date(2026, 6, 18).getTime(), now]);
	});

	it('uses calendar months for longer spans', () => {
		const { ends, period } = periodEnds(new Date(2025, 8, 15).getTime(), new Date(2026, 2, 10).getTime());
		expect(period).toBe('month');
		expect(ends.slice(0, 2)).toEqual([new Date(2025, 9, 1).getTime(), new Date(2025, 10, 1).getTime()]);
	});
});

describe('periodSeries', () => {
	const day = (d: number) => new Date(2026, 6, d).getTime();
	const ends = [day(12), day(19), day(20)];

	it('uses Obsidian figures for plugins, snapshots for themes and today’s counts last', () => {
		const a = row('plugin', 'a', 'Alpha', 30);
		const t = row('theme', 't', 'Tango', 9);
		const figures = {
			[String(day(12))]: { ids: ['a'], counts: { a: 4 } },
			[String(day(19))]: { ids: ['a'], counts: { a: 11 } },
		};
		const saved: Snapshot[] = [{ fetchedAt: day(18), counts: { 'theme:t': 7 }, names: {} }];
		const series = periodSeries([a, t], projectSlots([a, t], 'all'), ends, figures, saved);
		expect(series.map((s) => [s.label, s.points.map((p) => p.value)])).toEqual([
			['Alpha', [4, 11, 30]],
			['Tango', [7, 9]],
		]);
	});

	it('starts a plugin when it first appears in the figures', () => {
		const a = row('plugin', 'a', 'Alpha', 30);
		const figures: FiguresCache = { [String(day(12))]: { ids: ['a'], counts: {} }, [String(day(19))]: { ids: ['a'], counts: { a: 2 } } };
		const series = periodSeries([a], projectSlots([a], 'all'), ends, figures, []);
		expect(series[0]?.points.map((p) => p.time)).toEqual([day(19), day(20)]);
	});
});

describe('missingFigures', () => {
	it('asks again for dates fetched before a plugin was added', () => {
		const cache = { '1': { ids: ['a'], counts: { a: 1 } }, '2': { ids: ['a', 'b'], counts: {} } };
		expect(missingFigures([1, 2, 3], ['a'], cache)).toEqual([3]);
		expect(missingFigures([1, 2, 3], ['a', 'b'], cache)).toEqual([1, 3]);
	});
});

describe('niceTicks', () => {
	it('uses round steps that cover the range', () => {
		expect(niceTicks(0, 1120)).toEqual([0, 500, 1000, 1500]);
		expect(niceTicks(3194, 3260)).toEqual([3180, 3200, 3220, 3240, 3260]);
	});

	it('copes with a flat range', () => {
		expect(niceTicks(0, 0)).toEqual([0, 0.5, 1]);
	});
});
