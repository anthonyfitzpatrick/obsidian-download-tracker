import { requestUrl } from 'obsidian';
import {
	GitHubRelease,
	Row,
	isOwned,
	releaseDates,
	sortRows,
	statsFileVersions,
	sumManifestDownloads,
	sumReleaseFiles,
	toCount,
	toStars,
	toVisibility,
} from './counts';

const RAW = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/';
const GITHUB_API = 'https://api.github.com/';
const THEME_STATS_URLS = ['https://releases.obsidian.md/stats/theme', RAW + 'community-css-theme-stats.json'];

export interface Report {
	fetchedAt: number;
	query: string;
	plugins: Row[];
	themes: Row[];
	repos: Row[];
	notices: string[];
}

interface ListEntry {
	id?: string;
	name: string;
	repo: string;
}

type StatsFile = Record<string, Record<string, unknown> | undefined>;

class HttpError extends Error {
	constructor(readonly status: number) {
		super(`HTTP ${status}`);
	}
}

async function getJson(url: string, token = ''): Promise<unknown> {
	const headers: Record<string, string> = {};
	if (url.startsWith(GITHUB_API)) {
		headers.Accept = 'application/vnd.github+json';
		if (token) headers.Authorization = `Bearer ${token}`;
	}
	const res = await requestUrl({ url, headers, throw: false });
	if (res.status >= 400) throw new HttpError(res.status);
	return res.json as unknown;
}

async function githubReleases(repo: string, token: string): Promise<GitHubRelease[]> {
	const releases: GitHubRelease[] = [];
	for (let page = 1; ; page++) {
		const batch = (await getJson(`${GITHUB_API}repos/${repo}/releases?per_page=100&page=${page}`, token)) as GitHubRelease[];
		releases.push(...batch);
		if (batch.length < 100) return releases;
	}
}

async function firstThemeStats(): Promise<Record<string, unknown> | null> {
	for (const url of THEME_STATS_URLS) {
		try {
			return (await getJson(url)) as Record<string, unknown>;
		} catch {
			// Try the next source.
		}
	}
	return null;
}

export interface ReportOptions {
	usernames: string[];
	extraRepos: string[];
	withStars: boolean;
	withThemeDates: boolean;
	withAllRepos: boolean;
}

interface RepoInfo {
	full_name: string;
	private?: boolean;
	fork?: boolean;
	stargazers_count?: number;
}

export function queryKey(o: ReportOptions): string {
	return [
		'v4',
		...o.usernames,
		'|',
		...o.extraRepos,
		o.withStars ? '|stars' : '',
		o.withThemeDates ? '|theme-dates' : '',
		o.withAllRepos ? '|all-repos' : '',
	]
		.map((s) => s.toLowerCase())
		.join(',');
}

async function githubPages<T>(path: string, token: string): Promise<T[]> {
	const items: T[] = [];
	const joiner = path.includes('?') ? '&' : '?';
	for (let page = 1; ; page++) {
		const batch = (await getJson(`${GITHUB_API}${path}${joiner}per_page=100&page=${page}`, token)) as T[];
		items.push(...batch);
		if (batch.length < 100) return items;
	}
}

export async function loadReport(
	options: ReportOptions,
	token: string,
	onProgress: (message: string) => void,
): Promise<Report> {
	const { usernames, extraRepos, withStars, withThemeDates, withAllRepos } = options;
	const notices: string[] = [];

	onProgress('Loading the community lists...');
	const [pluginList, pluginStats, themeList] = await Promise.all([
		getJson(RAW + 'community-plugins.json').then((d) => d as ListEntry[]),
		getJson(RAW + 'community-plugin-stats.json').then(
			(d) => d as StatsFile,
			(): StatsFile => {
				notices.push("Obsidian's plugin stats file could not be loaded.");
				return {};
			},
		),
		getJson(RAW + 'community-css-themes.json').then(
			(d) => d as ListEntry[],
			(): ListEntry[] => {
				notices.push('The community theme list could not be loaded, so themes are not shown.');
				return [];
			},
		),
	]);

	const myPlugins = pluginList.filter((p) => isOwned(p.repo, usernames, extraRepos));
	const myThemes = themeList.filter((t) => isOwned(t.repo, usernames, extraRepos));
	const listed = new Set([...myPlugins, ...myThemes].map((e) => e.repo.toLowerCase()));

	// After the first refusal, later GitHub calls are skipped: they would be refused too.
	let githubBlocked: 'rate' | 'token' | null = null;
	const notFound = new Set<string>();
	let currentRepo = '';
	const fromGitHub = async <T>(call: () => Promise<T>): Promise<T | null> => {
		if (githubBlocked) return null;
		try {
			return await call();
		} catch (e) {
			if (!(e instanceof HttpError)) throw e;
			if (e.status === 403 || e.status === 429) githubBlocked = 'rate';
			else if (e.status === 401) githubBlocked = 'token';
			else if (e.status === 404) notFound.add(currentRepo);
			return null;
		}
	};

	// Repository listings already carry stars and visibility, so they fill this
	// cache and save a request per repository.
	const repoInfo = new Map<string, RepoInfo | null>();
	const info = async (repo: string): Promise<RepoInfo | null> => {
		const key = repo.toLowerCase();
		if (!repoInfo.has(key)) {
			currentRepo = repo;
			repoInfo.set(key, (await fromGitHub(() => getJson(`${GITHUB_API}repos/${repo}`, token))) as RepoInfo | null);
		}
		return repoInfo.get(key) ?? null;
	};
	const stars = async (repo: string) => (withStars ? toStars(await info(repo)) : null);
	const visibility = async (repo: string) => (withAllRepos ? toVisibility(await info(repo)) : null);

	const otherRepos = extraRepos.filter((r) => !listed.has(r.toLowerCase()));
	if (withAllRepos) {
		onProgress('Listing your repositories...');
		const me = token ? ((await fromGitHub(() => getJson(`${GITHUB_API}user`, token))) as { login?: string } | null) : null;
		const login = me?.login?.toLowerCase() ?? '';
		for (const user of usernames) {
			// Only the token owner's own listing includes private repositories.
			const path = user.toLowerCase() === login ? 'user/repos?affiliation=owner' : `users/${user}/repos?type=owner`;
			const owned = (await fromGitHub(() => githubPages<RepoInfo>(path, token))) ?? [];
			for (const r of owned) {
				repoInfo.set(r.full_name.toLowerCase(), r);
				const known = listed.has(r.full_name.toLowerCase()) || otherRepos.some((x) => x.toLowerCase() === r.full_name.toLowerCase());
				if (!r.fork && !known) otherRepos.push(r.full_name);
			}
		}
		if (!usernames.some((u) => u.toLowerCase() === login)) {
			notices.push(
				'Private repositories are listed only when the GitHub token belongs to one of these accounts and can read them.',
			);
		}
	}

	const plugins: Row[] = [];
	for (const [i, p] of myPlugins.entries()) {
		onProgress(`Checking plugin ${i + 1} of ${myPlugins.length}: ${p.name}...`);
		const id = p.id ?? p.repo;
		const stats = pluginStats[id];
		const fileCount = stats ? toCount(stats) : null;
		currentRepo = p.repo;
		const releases = await fromGitHub(() => githubReleases(p.repo, token));
		const live = releases ? sumManifestDownloads(releases) : null;
		const dates = releases ? releaseDates(releases) : null;
		const statsUpdated = stats && typeof stats.updated === 'number' ? stats.updated : null;
		plugins.push({
			kind: 'plugin',
			name: p.name,
			id,
			repo: p.repo,
			downloads: live ? live.total : fileCount,
			source: live ? 'live' : fileCount !== null ? 'file' : 'na',
			versions: live ? live.versions : stats ? statsFileVersions(stats) : [],
			stars: await stars(p.repo),
			firstRelease: dates ? dates.first : null,
			lastUpdated: dates ? dates.last : statsUpdated,
			visibility: await visibility(p.repo),
		});
	}

	let themes: Row[] = [];
	if (myThemes.length > 0) {
		onProgress('Checking theme download counts...');
		const themeStats = await firstThemeStats();
		if (!themeStats) notices.push('Theme download counts could not be loaded, so they show as n/a.');
		for (const [i, t] of myThemes.entries()) {
			onProgress(`Checking theme ${i + 1} of ${myThemes.length}: ${t.name}...`);
			const count = themeStats ? toCount(themeStats[t.name]) : null;
			currentRepo = t.repo;
			const releases = withThemeDates ? await fromGitHub(() => githubReleases(t.repo, token)) : null;
			const dates = releases ? releaseDates(releases) : null;
			themes.push({
				kind: 'theme',
				name: t.name,
				id: t.repo,
				repo: t.repo,
				downloads: count,
				source: count !== null ? 'file' : 'na',
				versions: [],
				stars: await stars(t.repo),
				firstRelease: dates ? dates.first : null,
				lastUpdated: dates ? dates.last : null,
				visibility: await visibility(t.repo),
			});
		}
	}

	const repos: Row[] = [];
	for (const [i, repo] of otherRepos.entries()) {
		onProgress(`Checking repository ${i + 1} of ${otherRepos.length}: ${repo}...`);
		currentRepo = repo;
		const releases = await fromGitHub(() => githubReleases(repo, token));
		const counted = releases ? sumReleaseFiles(releases) : null;
		const dates = releases ? releaseDates(releases) : null;
		const missing = notFound.has(repo);
		repos.push({
			kind: 'repo',
			name: repo.slice(repo.indexOf('/') + 1),
			id: repo,
			repo,
			downloads: counted ? counted.total : null,
			source: counted ? 'assets' : 'na',
			versions: counted ? counted.versions : [],
			stars: missing ? null : await stars(repo),
			firstRelease: dates ? dates.first : null,
			lastUpdated: dates ? dates.last : null,
			visibility: missing ? null : await visibility(repo),
		});
	}
	if (notFound.size > 0) notices.push(`Not found on GitHub, or private: ${[...notFound].join(', ')}.`);

	const starsNote =
		withStars || withThemeDates || withAllRepos || repos.length > 0 ? ' Anything else that needed GitHub shows as n/a.' : '';
	if (githubBlocked === 'rate') {
		notices.push(
			(token
				? "GitHub's rate limit was reached, so some plugins show Obsidian's stats file instead, which can lag. Try again later."
				: "GitHub's rate limit was reached, so some plugins show Obsidian's stats file instead, which can lag. Add a GitHub token in settings or try again later.") +
				starsNote,
		);
	} else if (githubBlocked === 'token') {
		notices.push(
			"GitHub rejected the token, so plugins show Obsidian's stats file instead. Check the token in settings." + starsNote,
		);
	}

	return {
		fetchedAt: Date.now(),
		query: queryKey(options),
		plugins: sortRows(plugins),
		themes: sortRows(themes),
		repos: sortRows(repos),
		notices,
	};
}
