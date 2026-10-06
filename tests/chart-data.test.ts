import { describe, expect, it } from 'vitest';
import { historyPoints, niceTicks, versionsOldestFirst } from '../src/chart-data';

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
