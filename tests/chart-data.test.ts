import { describe, expect, it } from 'vitest';
import { historyPoints, historySeries, kindMatches, nameMatches, niceTicks, projectSlots, releaseSeries, versionsOldestFirst } from '../src/chart-data';
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

describe('releaseSeries', () => {
	it('gives each project a running total that steps up at each release and ends today', () => {
		const a = row('plugin', 'a', 'Alpha', 30);
		a.versions = [
			{ version: '1.1.0', downloads: 20, published: 2000 },
			{ version: '1.0.0', downloads: 10, published: 1000 },
			{ version: '1.2.0', downloads: 0, published: null },
		];
		const t = row('theme', 't', 'Tango', 5);
		const series = releaseSeries([a, t], projectSlots([a, t], 'all'), 5000);
		expect(series).toEqual([
			{
				id: 'plugin:a',
				label: 'Alpha',
				cls: 'is-slot-1',
				points: [
					{ time: 1000, value: 10 },
					{ time: 2000, value: 30 },
					{ time: 5000, value: 30 },
				],
			},
		]);
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
