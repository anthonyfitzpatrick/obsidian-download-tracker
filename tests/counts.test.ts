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
	hasSnapshotOn,
	sortRows,
	statsFileVersions,
	sumManifestDownloads,
	sumReleaseFiles,
	sumKnown,
	obsidianTotal,
	summaryTable,
	toCount,
	toStars,
	toVisibility,
	hasManifestAssets,
	isRateLimited,
	countIssues,
	repoUrl,
	releaseDates,
	total,
} from '../src/counts';

function row(id: string, downloads: number | null, kind: Row['kind'] = 'plugin'): Row {
	return { kind, name: id.toUpperCase(), id, repo: `me/${id}`, downloads, source: 'live', versions: [], stars: null, firstRelease: null, lastUpdated: null, visibility: null, openIssues: null, openPulls: null };
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
			{ tag_name: '1.2.0', published_at: '2026-07-04T21:32:24Z', assets: [{ name: 'manifest.json', download_count: 5 }, { name: 'main.js', download_count: 99 }] },
			{ tag_name: '1.10.0', assets: [{ name: 'manifest.json', download_count: 7 }] },
			{ tag_name: '0.9.0' },
		]);
		expect(result.total).toBe(12);
		expect(result.versions).toEqual([
			{ version: '1.10.0', downloads: 7, published: null },
			{ version: '1.2.0', downloads: 5, published: Date.parse('2026-07-04T21:32:24Z') },
		]);
	});
});

describe('sumReleaseFiles', () => {
	it('sums every attached file and keeps releases without files at zero', () => {
		const result = sumReleaseFiles([
			{ tag_name: 'v2.0.0', assets: [{ name: 'app.zip', download_count: 5 }, { name: 'app.tar.gz', download_count: 3 }] },
			{ tag_name: 'v1.0.0' },
		]);
		expect(result.total).toBe(8);
		expect(result.versions).toEqual([
			{ version: 'v2.0.0', downloads: 8, published: null },
			{ version: 'v1.0.0', downloads: 0, published: null },
		]);
	});
});

describe('releaseDates', () => {
	it('uses the earliest and latest published releases whatever the list order', () => {
		const dates = releaseDates([
			{ tag_name: '0.1.5', draft: true, published_at: null },
			{ tag_name: '0.1.3', published_at: '2026-08-01T10:00:00Z' },
			{ tag_name: '0.2.0-beta', prerelease: true, published_at: '2026-09-01T10:00:00Z' },
			{ tag_name: '0.1.4', published_at: '2026-08-13T15:00:00Z' },
			{ tag_name: '0.1.0', published_at: '2026-07-04T21:00:00Z' },
		]);
		expect(dates.first).toBe(Date.parse('2026-07-04T21:00:00Z'));
		expect(dates.last).toBe(Date.parse('2026-08-13T15:00:00Z'));
	});

	it('gives null dates when nothing is published', () => {
		expect(releaseDates([{ tag_name: '1.0.0', draft: true }])).toEqual({ first: null, last: null });
	});
});

describe('hasManifestAssets', () => {
	it('tells released themes from themes installed from the repository', () => {
		expect(hasManifestAssets([{ tag_name: '1.0.4', assets: [{ name: 'manifest.json', download_count: 524 }, { name: 'theme.css', download_count: 522 }] }])).toBe(true);
		expect(hasManifestAssets([{ tag_name: 'v1', assets: [{ name: 'source.zip', download_count: 3 }] }])).toBe(false);
		expect(hasManifestAssets([])).toBe(false);
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

describe('toStars', () => {
	it('reads stargazers_count from a repository response', () => {
		expect(toStars({ full_name: 'me/a', stargazers_count: 12 })).toBe(12);
		expect(toStars({ full_name: 'me/a' })).toBeNull();
		expect(toStars(null)).toBeNull();
	});
});

describe('toVisibility', () => {
	it('reads the private flag from a repository response', () => {
		expect(toVisibility({ full_name: 'me/a', private: true })).toBe('private');
		expect(toVisibility({ full_name: 'me/a', private: false })).toBe('public');
		expect(toVisibility({ full_name: 'me/a' })).toBeNull();
		expect(toVisibility(null)).toBeNull();
	});
});

describe('isRateLimited', () => {
	it('tells a rate limit from a missing permission', () => {
		expect(isRateLimited(429, {}, '')).toBe(true);
		expect(isRateLimited(403, { 'X-RateLimit-Remaining': '0' }, '')).toBe(true);
		expect(isRateLimited(403, {}, '{"message":"You have exceeded a secondary rate limit"}')).toBe(true);
		expect(isRateLimited(403, { 'x-ratelimit-remaining': '4990' }, '{"message":"Resource not accessible by personal access token"}')).toBe(false);
		expect(isRateLimited(404, {}, '')).toBe(false);
	});
});

describe('countIssues', () => {
	it('leaves out pull requests', () => {
		expect(countIssues([{}, { pull_request: { url: 'x' } }, {}])).toBe(2);
	});
});

describe('repoUrl', () => {
	it('builds the GitHub address', () => {
		expect(repoUrl('me/thing')).toBe('https://github.com/me/thing');
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

	it('sums known values and gives null when none are known', () => {
		expect(sumKnown([3, null, 4])).toBe(7);
		expect(sumKnown([null, null])).toBeNull();
	});

	it('leaves other repositories out of the plugins and themes total', () => {
		expect(obsidianTotal([row('a', 5), row('t', 2, 'theme'), row('r', 100, 'repo')])).toBe(7);
	});
});

describe('snapshots and deltas', () => {
	const first = makeSnapshot([row('a', 10), row('b', null)], 1000);
	const second = makeSnapshot([row('a', 15)], 2000);

	it('leaves out rows without a count', () => {
		expect(first.counts).toEqual({ 'plugin:a': 10 });
	});

	it('knows whether a snapshot was saved on a given day', () => {
		const morning = makeSnapshot([row('a', 1)], new Date(2026, 9, 7, 8, 0).getTime());
		expect(hasSnapshotOn([morning], new Date(2026, 9, 7, 23, 0).getTime())).toBe(true);
		expect(hasSnapshotOn([morning], new Date(2026, 9, 8, 0, 5).getTime())).toBe(false);
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

	it('gives no change when the count source differs from the snapshot', () => {
		const fallback: Row = { ...row('a', 12), source: 'file' };
		expect(delta(fallback, second)).toBeNull();
		const { sources: _ignored, ...older } = second;
		expect(delta(fallback, older)).toBe(-3);
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
				'| | Plugins and themes | 1,234 | | |',
			].join('\n'),
		);
	});

	it('writes one history row per snapshot in date order', () => {
		const later = makeSnapshot([row('a', 12), row('b', 3), row('r', 50, 'repo')], new Date(2026, 9, 7, 9, 0).getTime());
		const earlier = makeSnapshot([row('a', 10)], new Date(2026, 9, 6, 9, 0).getTime());
		expect(historyTable([later, earlier])).toBe(
			[
				'| Date | A | B | R | Plugins and themes |',
				'| --- | ---: | ---: | ---: | ---: |',
				'| 2026-10-06 09:00 | 10 |  |  | 10 |',
				'| 2026-10-07 09:00 | 12 | 3 | 50 | 15 |',
			].join('\n'),
		);
	});
});
