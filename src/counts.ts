export type Kind = 'plugin' | 'theme' | 'repo';
export type Source = 'live' | 'assets' | 'file' | 'na';
export type Visibility = 'public' | 'private';

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
	stars: number | null;
	firstRelease: number | null;
	lastUpdated: number | null;
	visibility: Visibility | null;
	openIssues: number | null;
	openPulls: number | null;
}

export interface Snapshot {
	fetchedAt: number;
	counts: Record<string, number>;
	names: Record<string, string>;
	sources?: Record<string, Source>;
}

export interface GitHubRelease {
	tag_name: string;
	draft?: boolean;
	prerelease?: boolean;
	published_at?: string | null;
	assets?: { name: string; download_count: number }[];
}

export const SOURCE_LABELS: Record<Source, string> = {
	live: 'GitHub live',
	assets: 'GitHub release files',
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

// For repositories outside Obsidian's lists there is no manifest.json to count,
// so every file attached to a release counts, each download separately.
export function sumReleaseFiles(releases: GitHubRelease[]): { total: number; versions: VersionCount[] } {
	let total = 0;
	const versions: VersionCount[] = [];
	for (const release of releases) {
		const downloads = (release.assets ?? []).reduce((sum, a) => sum + a.download_count, 0);
		total += downloads;
		versions.push({ version: release.tag_name, downloads });
	}
	return { total, versions: sortVersions(versions) };
}

// GitHub doesn't return releases in date order, drafts have no date, and
// Obsidian doesn't install pre-releases, so only published releases count.
export function releaseDates(releases: GitHubRelease[]): { first: number | null; last: number | null } {
	let first: number | null = null;
	let last: number | null = null;
	for (const r of releases) {
		if (r.draft || r.prerelease || !r.published_at) continue;
		const time = Date.parse(r.published_at);
		if (isNaN(time)) continue;
		if (first === null || time < first) first = time;
		if (last === null || time > last) last = time;
	}
	return { first, last };
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

export function toStars(repoInfo: unknown): number | null {
	if (repoInfo && typeof repoInfo === 'object') {
		const count = (repoInfo as Record<string, unknown>).stargazers_count;
		if (typeof count === 'number') return count;
	}
	return null;
}

// GitHub answers 403 both for rate limits and for missing permissions. Only a
// rate limit should stop the remaining GitHub calls.
export function isRateLimited(status: number, headers: Record<string, string>, body: string): boolean {
	if (status === 429) return true;
	if (status !== 403) return false;
	const remaining = Object.entries(headers).find(([k]) => k.toLowerCase() === 'x-ratelimit-remaining')?.[1];
	return remaining === '0' || /rate limit/i.test(body);
}

export function countIssues(items: { pull_request?: unknown }[]): number {
	return items.filter((i) => i.pull_request === undefined).length;
}

export function repoUrl(repo: string): string {
	return `https://github.com/${repo}`;
}

export function toVisibility(repoInfo: unknown): Visibility | null {
	if (repoInfo && typeof repoInfo === 'object') {
		const isPrivate = (repoInfo as Record<string, unknown>).private;
		if (typeof isPrivate === 'boolean') return isPrivate ? 'private' : 'public';
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

export function sumKnown(values: (number | null)[]): number | null {
	const known = values.filter((v): v is number => v !== null);
	return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;
}

// Release-file downloads mean something different from Obsidian downloads, so they stay out of this total.
export function obsidianTotal(rows: Row[]): number {
	return total(rows.filter((r) => r.kind !== 'repo'));
}

export function makeSnapshot(rows: Row[], fetchedAt: number): Snapshot {
	const counts: Record<string, number> = {};
	const names: Record<string, string> = {};
	const sources: Record<string, Source> = {};
	for (const row of rows) {
		if (row.downloads === null) continue;
		counts[rowKey(row)] = row.downloads;
		names[rowKey(row)] = row.name;
		sources[rowKey(row)] = row.source;
	}
	return { fetchedAt, counts, names, sources };
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

// A live count and a stats-file count can be days apart, so comparing across
// sources would show a change that didn't happen. Older snapshots have no sources.
export function delta(row: Row, previous: Snapshot | undefined): number | null {
	if (!previous || row.downloads === null) return null;
	const before = previous.counts[rowKey(row)];
	const source = previous.sources?.[rowKey(row)];
	if (before === undefined || (source !== undefined && source !== row.source)) return null;
	return row.downloads - before;
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

export const KIND_LABELS: Record<Kind, string> = { plugin: 'Plugin', theme: 'Theme', repo: 'Repository' };

export function summaryText(rows: Row[], fetchedAt: number): string {
	const lines = [`Download counts (${formatDate(fetchedAt)})`, ''];
	for (const r of rows) {
		lines.push(`${KIND_LABELS[r.kind]}: ${r.name}: ${formatCount(r.downloads)} (${SOURCE_LABELS[r.source]})`);
	}
	lines.push('', `Plugins and themes: ${formatCount(obsidianTotal(rows))}`);
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
	lines.push(`| | Plugins and themes | ${formatCount(obsidianTotal(rows))} | | |`);
	return lines.join('\n');
}

export function historyTable(snapshots: Snapshot[]): string {
	const ordered = [...snapshots].sort((a, b) => a.fetchedAt - b.fetchedAt);
	const names: Record<string, string> = {};
	for (const s of ordered) Object.assign(names, s.names);
	const keys = Object.keys(names).sort((a, b) => a.localeCompare(b));
	const lines = [
		`| Date | ${keys.map((k) => cell(names[k] ?? k)).join(' | ')} | Plugins and themes |`,
		`| --- | ${keys.map(() => '---:').join(' | ')} | ---: |`,
	];
	for (const s of ordered) {
		const values = keys.map((k) => {
			const v = s.counts[k];
			return v === undefined ? '' : formatCount(v);
		});
		const sum = Object.entries(s.counts).reduce((a, [k, v]) => (k.startsWith('repo:') ? a : a + v), 0);
		lines.push(`| ${formatDate(s.fetchedAt)} | ${values.join(' | ')} | ${formatCount(sum)} |`);
	}
	return lines.join('\n');
}
