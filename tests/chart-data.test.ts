import { describe, expect, it } from 'vitest';
import { historyPoints, historySeries, kindMatches, nameMatches, niceTicks, versionsOldestFirst } from '../src/chart-data';
import type { Snapshot } from '../src/counts';

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
		expect(series.map((s) => [s.id, s.points.map((p) => p.value)])).toEqual([
			['total', [14, 17]],
			['plugin', [10, 12]],
			['theme', [4, 5]],
		]);
	});

	it('draws one line for a single type, and drops a total that would equal its only part', () => {
		expect(historySeries(snaps, { kind: 'theme', query: '' }).map((s) => s.id)).toEqual(['theme']);
		expect(historySeries(snaps, { kind: 'all', query: 'alpha' }).map((s) => s.id)).toEqual(['plugin']);
		expect(historySeries(snaps, { kind: 'all', query: 'nothing' })).toEqual([]);
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
