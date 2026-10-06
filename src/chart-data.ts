import { Snapshot, VersionCount, compareVersions } from './counts';

export interface Point {
	time: number;
	value: number;
}

// Plugins and themes only: release-file counts of other repositories mean something else.
export function historyPoints(snapshots: Snapshot[]): Point[] {
	return [...snapshots]
		.sort((a, b) => a.fetchedAt - b.fetchedAt)
		.map((s) => ({
			time: s.fetchedAt,
			value: Object.entries(s.counts).reduce((sum, [key, v]) => (key.startsWith('repo:') ? sum : sum + v), 0),
		}));
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
