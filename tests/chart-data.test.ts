import { describe, expect, it } from 'vitest';
import { kindMatches, nameMatches, niceTicks, missingFigures, periodEnds, rangeEnds, periodSeries, periodTotals, projectSlots, gainSeries, releasesIn } from '../src/chart-data';
import type { FiguresCache } from '../src/chart-data';
import type { Row, Snapshot } from '../src/counts';

function row(kind: Row['kind'], id: string, name: string, downloads: number | null): Row {
	return { kind, name, id, repo: `me/${id}`, downloads, source: 'live', versions: [], stars: null, firstRelease: null, lastUpdated: null, visibility: null, openIssues: null, openPulls: null };
}


describe('filters', () => {
	it('treats All as plugins and themes, and matches names case-insensitively', () => {
		expect(kindMatches('plugin', 'all')).toBe(true);
		expect(kindMatches('repo', 'all')).toBe(false);
		expect(kindMatches('repo', 'repo')).toBe(true);
		expect(nameMatches('Metadata Visuals', ' visu ')).toBe(true);
		expect(nameMatches('Metadata Visuals', 'amiga')).toBe(false);
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

describe('rangeEnds', () => {
	const now = new Date(2026, 9, 7, 10, 30).getTime();
	const first = new Date(2026, 6, 4, 21, 0).getTime();

	it('gives daily points for the last 7 days, ending now', () => {
		const { ends, period } = rangeEnds('week', first, now);
		expect(period).toBe('day');
		expect(ends.length).toBe(8);
		expect(ends[0]).toBe(new Date(2026, 8, 31).getTime());
		expect(ends[ends.length - 1]).toBe(now);
	});

	it('gives a point every 3 days for the last month and weekly for the last quarter', () => {
		expect(rangeEnds('month', first, now).ends.slice(0, 2)).toEqual([new Date(2026, 8, 10).getTime(), new Date(2026, 8, 13).getTime()]);
		const quarter = rangeEnds('quarter', first, now);
		expect(quarter.period).toBe('week');
		expect(quarter.ends[0]).toBe(new Date(2026, 6, 14).getTime());
	});

	it('starts at the first release when the range reaches back further', () => {
		const { ends, period } = rangeEnds('year', first, now);
		expect(period).toBe('month');
		expect(ends).toEqual([new Date(2026, 7, 1).getTime(), new Date(2026, 8, 1).getTime(), new Date(2026, 9, 1).getTime(), now]);
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

describe('periodTotals', () => {
	const day = (d: number) => new Date(2026, 6, d).getTime();
	const ends = [day(12), day(19), day(26), day(30)];
	const plugin = row('plugin', 'a', 'Alpha', 40);
	plugin.versions = [{ version: '1.0.0', downloads: 40, published: day(1) }];
	const theme = row('theme', 't', 'Tango', 9);
	theme.versions = [{ version: '1.0.0', downloads: 9, published: day(15) }];
	const figures: FiguresCache = {
		[String(day(12))]: { ids: ['a'], counts: { a: 10 } },
		[String(day(19))]: { ids: ['a'], counts: { a: 20 } },
		[String(day(26))]: { ids: ['a'], counts: { a: 30 } },
	};
	const saved: Snapshot[] = [{ fetchedAt: day(25), counts: { 'theme:t': 6 }, names: {} }];

	it('counts a theme as zero before its release and estimates it until its first record', () => {
		const series = periodTotals([plugin, theme], 'all', ends, figures, []);
		// Released on the 15th, first record is today's 9 on the 30th: 4/15 and 11/15 of the way.
		expect(series.map((s) => [s.id, s.points.map((p) => [p.value, p.estimated ?? false])])).toEqual([
			['total', [[10, false], [22, true], [37, true], [49, false]]],
			['plugin', [[10, false], [20, false], [30, false], [40, false]]],
			['theme', [[2, true], [7, true], [9, false]]],
		]);
	});

	it('uses snapshots where there are any and estimates only before the first', () => {
		const series = periodTotals([plugin, theme], 'all', ends, figures, saved);
		// 4/10 of the way from release (15th) to the snapshot of 6 (25th).
		expect(series[2]?.points.map((p) => [p.value, p.estimated ?? false])).toEqual([
			[2, true],
			[6, false],
			[9, false],
		]);
	});

	it('never estimates a plugin whose figures are not loaded', () => {
		const series = periodTotals([plugin], 'plugin', ends, {}, []);
		expect(series[0]?.points.map((p) => p.value)).toEqual([40]);
	});

	it('draws one line for a single type', () => {
		expect(periodTotals([plugin, theme], 'theme', ends, figures, saved).map((s) => s.id)).toEqual(['theme']);
	});
});

describe('gainSeries', () => {
	const ends = [10, 20, 30, 40, 50];
	const base = { id: 'p', label: 'P', cls: 'is-slot-1' };

	it('gives the gain in each complete period and leaves out the running one', () => {
		const series = gainSeries([{ ...base, points: [{ time: 10, value: 5 }, { time: 20, value: 12 }, { time: 30, value: 20 }, { time: 50, value: 40 }] }], ends);
		expect(series[0]?.points).toEqual([
			{ time: 20, value: 7 },
			{ time: 30, value: 8 },
		]);
	});

	it('gives no gain across a gap or an estimate', () => {
		const series = gainSeries(
			[{ ...base, points: [{ time: 10, value: 1, estimated: true }, { time: 20, value: 4 }, { time: 40, value: 9 }] }],
			ends,
		);
		expect(series).toEqual([]);
	});
});

describe('gains for a newly released plugin', () => {
	it('counts the first period from zero before release', () => {
		const day = (d: number) => new Date(2026, 8, d).getTime();
		const ends = [day(25), new Date(2026, 9, 2).getTime(), new Date(2026, 9, 7).getTime()];
		const p = row('plugin', 'd', 'Discogs', 21);
		p.versions = [{ version: '1.0.0', downloads: 21, published: day(29) }];
		const figures: FiguresCache = { [String(ends[1])]: { ids: ['d'], counts: { d: 11 } } };
		const cumulative = periodSeries([p], projectSlots([p], 'all'), ends, figures, [], true);
		expect(gainSeries(cumulative, ends)[0]?.points).toEqual([{ time: ends[1], value: 11 }]);
		const earlier = [new Date(2026, 8, 18).getTime(), ...ends];
		const fromJuly = periodSeries([p], projectSlots([p], 'all'), earlier, figures, [], true);
		expect(gainSeries(fromJuly, earlier)[0]?.points).toEqual([{ time: ends[1], value: 11 }]);
		expect(periodSeries([p], projectSlots([p], 'all'), ends, figures, [])[0]?.points.map((x) => x.value)).toEqual([11, 21]);
	});
});

describe('releasesIn', () => {
	it('lists published releases inside the range, oldest first, in the project colour', () => {
		const a = row('plugin', 'a', 'Alpha', 30);
		a.versions = [
			{ version: '1.1.0', downloads: 20, published: 300 },
			{ version: '1.0.0', downloads: 10, published: 100 },
			{ version: '1.2.0', downloads: 0, published: null },
		];
		const releases = releasesIn([a], projectSlots([a], 'all'), 150, 1000);
		expect(releases).toEqual([{ time: 300, project: 'Alpha', version: '1.1.0', cls: 'is-slot-1', id: 'plugin:a' }]);
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
