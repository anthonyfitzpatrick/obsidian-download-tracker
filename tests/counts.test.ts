import { describe, expect, it } from 'vitest';
import {
	Row,
	compareVersions,
	delta,
	historyTable,
	isOwned,
	makeSnapshot,
	parseList,
	previousSnapshot,
	sortRows,
	statsFileVersions,
	sumManifestDownloads,
	summaryTable,
	toCount,
	total,
} from '../src/counts';

function row(id: string, downloads: number | null, kind: Row['kind'] = 'plugin'): Row {
	return { kind, name: id.toUpperCase(), id, repo: `me/${id}`, downloads, source: 'live', versions: [] };
}

describe('parseList', () => {
	it('splits on commas, spaces and new lines and drops blanks', () => {
		expect(parseList(' alice, @bob\n\ncarol/repo ,')).toEqual(['alice', 'bob', 'carol/repo']);
		expect(parseList('')).toEqual([]);
	});
});

describe('isOwned', () => {
	it('matches the owner prefix without case and not partial names', () => {
		expect(isOwned('Alice/thing', ['alice'], [])).toBe(true);
		expect(isOwned('alicex/thing', ['alice'], [])).toBe(false);
	});

	it('matches extra repositories exactly', () => {
		expect(isOwned('org/Plugin', [], ['org/plugin'])).toBe(true);
		expect(isOwned('org/plugin-two', [], ['org/plugin'])).toBe(false);
	});
});

describe('sumManifestDownloads', () => {
	it('sums only manifest.json assets and lists versions newest first', () => {
		const result = sumManifestDownloads([
			{ tag_name: '1.2.0', assets: [{ name: 'manifest.json', download_count: 5 }, { name: 'main.js', download_count: 99 }] },
			{ tag_name: '1.10.0', assets: [{ name: 'manifest.json', download_count: 7 }] },
			{ tag_name: '0.9.0' },
		]);
		expect(result.total).toBe(12);
		expect(result.versions).toEqual([
			{ version: '1.10.0', downloads: 7 },
			{ version: '1.2.0', downloads: 5 },
		]);
	});
});

describe('statsFileVersions', () => {
	it('reads version keys and skips the summary fields', () => {
		expect(statsFileVersions({ downloads: 30, updated: 1700000000000, '0.1.0': 10, '0.2.0': 20 })).toEqual([
			{ version: '0.2.0', downloads: 20 },
			{ version: '0.1.0', downloads: 10 },
		]);
	});
});

describe('toCount', () => {
	it('reads numbers and the known object shapes', () => {
		expect(toCount(4.6)).toBe(5);
		expect(toCount({ downloads: 10 })).toBe(10);
		expect(toCount({ id: 'Theme', download: 3 })).toBe(3);
		expect(toCount({ other: 1 })).toBeNull();
		expect(toCount(undefined)).toBeNull();
	});
});

describe('compareVersions', () => {
	it('compares numeric parts as numbers', () => {
		expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
		expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
		expect(compareVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
		expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);
	});
});

describe('totals and sorting', () => {
	it('treats missing counts as zero in totals and sorts them last', () => {
		const rows = sortRows([row('a', null), row('b', 5), row('c', 9)]);
		expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
		expect(total(rows)).toBe(14);
	});
});

describe('snapshots and deltas', () => {
	const first = makeSnapshot([row('a', 10), row('b', null)], 1000);
	const second = makeSnapshot([row('a', 15)], 2000);

	it('leaves out rows without a count', () => {
		expect(first.counts).toEqual({ 'plugin:a': 10 });
	});

	it('uses the latest snapshot taken before the counts were fetched', () => {
		expect(previousSnapshot([first, second], 2000)).toBe(first);
		expect(previousSnapshot([first, second], 3000)).toBe(second);
		expect(previousSnapshot([first], 1000)).toBeUndefined();
	});

	it('computes the change, or null when there is nothing to compare', () => {
		expect(delta(row('a', 18), second)).toBe(3);
		expect(delta(row('new', 4), second)).toBeNull();
		expect(delta(row('a', null), second)).toBeNull();
		expect(delta(row('a', 18), undefined)).toBeNull();
	});
});

describe('markdown output', () => {
	it('writes a summary table with change and a total row', () => {
		const previous = makeSnapshot([row('a', 10)], 1000);
		const table = summaryTable([row('a', 1234), row('t|x', null, 'theme')], new Date(2026, 9, 6, 14, 5).getTime(), previous);
		expect(table).toBe(
			[
				'Download counts fetched 2026-10-06 14:05.',
				'',
				'| Type | Name | Downloads | Change | Source |',
				'| --- | --- | ---: | ---: | --- |',
				'| Plugin | A | 1,234 | +1,224 | GitHub live |',
				'| Theme | T\\|X | n/a | n/a | GitHub live |',
				'| | Total | 1,234 | | |',
			].join('\n'),
		);
	});

	it('writes one history row per snapshot in date order', () => {
		const later = makeSnapshot([row('a', 12), row('b', 3)], new Date(2026, 9, 7, 9, 0).getTime());
		const earlier = makeSnapshot([row('a', 10)], new Date(2026, 9, 6, 9, 0).getTime());
		expect(historyTable([later, earlier])).toBe(
			[
				'| Date | A | B | Total |',
				'| --- | ---: | ---: | ---: |',
				'| 2026-10-06 09:00 | 10 |  | 10 |',
				'| 2026-10-07 09:00 | 12 | 3 | 15 |',
			].join('\n'),
		);
	});
});
