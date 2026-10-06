import { describe, expect, it } from 'vitest';
import { historyPoints, historySeries, kindMatches, nameMatches, niceTicks, projectSeries, versionsOldestFirst } from '../src/chart-data';
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

describe('projectSeries', () => {
	const current = {
		time: 3000,
		rows: [row('plugin', 'a', 'Alpha', 20), row('theme', 't', 'Tango', 6), row('repo', 'r', 'Romeo', 70)],
	};

	it('draws one line per project with snapshots and current counts', () => {
		const series = projectSeries(snaps, { kind: 'all', query: '' }, current);
		expect(series.map((s) => [s.label, s.cls, s.points.map((p) => p.value)])).toEqual([
			['Alpha', 'is-slot-1', [10, 12, 20]],
			['Tango', 'is-slot-2', [4, 5, 6]],
		]);
	});

	it('keeps each colour when the filter narrows the view', () => {
		const themes = projectSeries(snaps, { kind: 'theme', query: '' }, current);
		expect(themes.map((s) => [s.label, s.cls])).toEqual([['Tango', 'is-slot-2']]);
	});

	it('folds projects past eight into one Other line', () => {
		const many = Array.from({ length: 10 }, (_, i) => row('plugin', `p${i}`, `P${i}`, 100 - i));
		const series = projectSeries([], { kind: 'all', query: '' }, { time: 1, rows: many });
		expect(series.length).toBe(8);
		expect(series[7]?.label).toBe('Other (3)');
		expect(series[7]?.points[0]?.value).toBe(93 + 92 + 91);
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

describe('versionsOldestFirst', () => {
	it('orders versions numerically', () => {
		const ordered = versionsOldestFirst([
			{ version: '0.10.0', downloads: 1 },
			{ version: '0.2.0', downloads: 2 },
			{ version: '0.9.1', downloads: 3 },
		]);
		expect(ordered.map((v) => v.version)).toEqual(['0.2.0', '0.9.1', '0.10.0']);
	});
});
