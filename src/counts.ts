export type Kind = 'plugin' | 'theme';
export type Source = 'live' | 'file' | 'na';

export interface VersionCount {
	version: string;
	downloads: number;
}

export interface Row {
	kind: Kind;
	name: string;
	id: string;
	repo: string;
	downloads: number | null;
	source: Source;
	versions: VersionCount[];
}

export interface Snapshot {
	fetchedAt: number;
	counts: Record<string, number>;
	names: Record<string, string>;
}

export interface GitHubRelease {
	tag_name: string;
	assets?: { name: string; download_count: number }[];
}

export const SOURCE_LABELS: Record<Source, string> = {
	live: 'GitHub live',
	file: 'Obsidian stats file',
	na: 'not available',
};

export function parseList(text: string): string[] {
	return text
		.split(/[\s,]+/)
		.map((s) => s.trim().replace(/^@/, ''))
		.filter((s) => s.length > 0);
}

export function isOwned(repo: string, usernames: string[], extraRepos: string[]): boolean {
	const r = repo.toLowerCase();
	return (
		usernames.some((u) => r.startsWith(u.toLowerCase() + '/')) ||
		extraRepos.some((x) => x.toLowerCase() === r)
	);
}

// Obsidian counts a download each time a release's manifest.json is fetched,
// so summing that asset across releases reproduces its number.
export function sumManifestDownloads(releases: GitHubRelease[]): { total: number; versions: VersionCount[] } {
	let total = 0;
	const versions: VersionCount[] = [];
	for (const release of releases) {
		const manifest = (release.assets ?? []).find((a) => a.name === 'manifest.json');
		if (!manifest) continue;
		total += manifest.download_count;
		versions.push({ version: release.tag_name, downloads: manifest.download_count });
	}
	return { total, versions: sortVersions(versions) };
}

// Stats file entries hold "downloads" and "updated" alongside one key per version.
export function statsFileVersions(entry: Record<string, unknown>): VersionCount[] {
	const versions: VersionCount[] = [];
	for (const [key, value] of Object.entries(entry)) {
		if (key === 'downloads' || key === 'updated') continue;
		if (typeof value === 'number') versions.push({ version: key, downloads: value });
	}
	return sortVersions(versions);
}

export function toCount(value: unknown): number | null {
	if (typeof value === 'number') return Math.round(value);
	if (value && typeof value === 'object') {
		const v = value as Record<string, unknown>;
		for (const key of ['downloads', 'download', 'total']) {
			if (typeof v[key] === 'number') return Math.round(v[key]);
		}
	}
	return null;
}

export function compareVersions(a: string, b: string): number {
	const pa = a.replace(/^v/i, '').split(/[.-]/);
	const pb = b.replace(/^v/i, '').split(/[.-]/);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] ?? '';
		const y = pb[i] ?? '';
		// A missing part beats a pre-release tag (1.0.0 > 1.0.0-beta) and loses to a number (1.0 < 1.0.1).
		if (x === '') return isNaN(Number(y)) ? 1 : -1;
		if (y === '') return isNaN(Number(x)) ? -1 : 1;
		const nx = Number(x);
		const ny = Number(y);
		const diff = x !== '' && y !== '' && !isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y);
		if (diff !== 0) return diff;
	}
	return 0;
}

function sortVersions(versions: VersionCount[]): VersionCount[] {
	return versions.sort((a, b) => compareVersions(b.version, a.version));
}

export function sortRows(rows: Row[]): Row[] {
	return rows.sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1) || a.name.localeCompare(b.name));
}

export function rowKey(row: Pick<Row, 'kind' | 'id'>): string {
	return `${row.kind}:${row.id}`;
}

export function total(rows: Row[]): number {
	return rows.reduce((sum, r) => sum + (r.downloads ?? 0), 0);
}

export function makeSnapshot(rows: Row[], fetchedAt: number): Snapshot {
	const snapshot: Snapshot = { fetchedAt, counts: {}, names: {} };
	for (const row of rows) {
		if (row.downloads === null) continue;
		snapshot.counts[rowKey(row)] = row.downloads;
		snapshot.names[rowKey(row)] = row.name;
	}
	return snapshot;
}

// Compares with the latest snapshot taken from earlier counts, so saving a
// snapshot of the counts on screen does not reset the change column to zero.
export function previousSnapshot(snapshots: Snapshot[], fetchedAt: number): Snapshot | undefined {
	let best: Snapshot | undefined;
	for (const s of snapshots) {
		if (s.fetchedAt < fetchedAt && (!best || s.fetchedAt > best.fetchedAt)) best = s;
	}
	return best;
}

export function delta(row: Row, previous: Snapshot | undefined): number | null {
	if (!previous || row.downloads === null) return null;
	const before = previous.counts[rowKey(row)];
	return before === undefined ? null : row.downloads - before;
}

export function formatCount(n: number | null): string {
	return n === null ? 'n/a' : n.toLocaleString('en-US');
}

export function formatDelta(n: number | null): string {
	if (n === null) return 'n/a';
	return n > 0 ? `+${formatCount(n)}` : formatCount(n);
}

export function formatDate(time: number): string {
	const d = new Date(time);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cell(text: string): string {
	return text.replace(/\|/g, '\\|');
}

const KIND_LABELS: Record<Kind, string> = { plugin: 'Plugin', theme: 'Theme' };

export function summaryText(rows: Row[], fetchedAt: number): string {
	const lines = [`Download counts (${formatDate(fetchedAt)})`, ''];
	for (const r of rows) {
		lines.push(`${KIND_LABELS[r.kind]}: ${r.name}: ${formatCount(r.downloads)} (${SOURCE_LABELS[r.source]})`);
	}
	lines.push('', `Total: ${formatCount(total(rows))}`);
	return lines.join('\n');
}

export function summaryTable(rows: Row[], fetchedAt: number, previous: Snapshot | undefined): string {
	const lines = [
		`Download counts fetched ${formatDate(fetchedAt)}.`,
		'',
		'| Type | Name | Downloads | Change | Source |',
		'| --- | --- | ---: | ---: | --- |',
	];
	for (const r of rows) {
		lines.push(
			`| ${KIND_LABELS[r.kind]} | ${cell(r.name)} | ${formatCount(r.downloads)} | ${formatDelta(delta(r, previous))} | ${SOURCE_LABELS[r.source]} |`,
		);
	}
	lines.push(`| | Total | ${formatCount(total(rows))} | | |`);
	return lines.join('\n');
}

export function historyTable(snapshots: Snapshot[]): string {
	const ordered = [...snapshots].sort((a, b) => a.fetchedAt - b.fetchedAt);
	const names: Record<string, string> = {};
	for (const s of ordered) Object.assign(names, s.names);
	const keys = Object.keys(names).sort((a, b) => a.localeCompare(b));
	const lines = [
		`| Date | ${keys.map((k) => cell(names[k] ?? k)).join(' | ')} | Total |`,
		`| --- | ${keys.map(() => '---:').join(' | ')} | ---: |`,
	];
	for (const s of ordered) {
		const values = keys.map((k) => {
			const v = s.counts[k];
			return v === undefined ? '' : formatCount(v);
		});
		const sum = Object.values(s.counts).reduce((a, b) => a + b, 0);
		lines.push(`| ${formatDate(s.fetchedAt)} | ${values.join(' | ')} | ${formatCount(sum)} |`);
	}
	return lines.join('\n');
}
