import { requestUrl } from 'obsidian';
import {
	GitHubRelease,
	Row,
	isOwned,
	sortRows,
	statsFileVersions,
	sumManifestDownloads,
	sumReleaseFiles,
	toCount,
	toStars,
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

export function queryKey(usernames: string[], extraRepos: string[], withStars: boolean): string {
	return ['v2', ...usernames, '|', ...extraRepos, withStars ? '|stars' : ''].map((s) => s.toLowerCase()).join(',');
}

export async function loadReport(
	usernames: string[],
	extraRepos: string[],
	withStars: boolean,
	token: string,
	onProgress: (message: string) => void,
): Promise<Report> {
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
	const missing = extraRepos.filter((r) => !listed.has(r.toLowerCase()));

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
	const stars = async (repo: string): Promise<number | null> => {
		if (!withStars) return null;
		const info = await fromGitHub(() => getJson(`${GITHUB_API}repos/${repo}`, token));
		return toStars(info);
	};

	const plugins: Row[] = [];
	for (const [i, p] of myPlugins.entries()) {
		onProgress(`Checking plugin ${i + 1} of ${myPlugins.length}: ${p.name}...`);
		const id = p.id ?? p.repo;
		const stats = pluginStats[id];
		const fileCount = stats ? toCount(stats) : null;
		currentRepo = p.repo;
		const live = await fromGitHub(async () => sumManifestDownloads(await githubReleases(p.repo, token)));
		plugins.push({
			kind: 'plugin',
			name: p.name,
			id,
			repo: p.repo,
			downloads: live ? live.total : fileCount,
			source: live ? 'live' : fileCount !== null ? 'file' : 'na',
			versions: live ? live.versions : stats ? statsFileVersions(stats) : [],
			stars: await stars(p.repo),
		});
	}

	let themes: Row[] = [];
	if (myThemes.length > 0) {
		onProgress('Checking theme download counts...');
		const themeStats = await firstThemeStats();
		if (!themeStats) notices.push('Theme download counts could not be loaded, so they show as n/a.');
		for (const [i, t] of myThemes.entries()) {
			if (withStars) onProgress(`Checking stars for theme ${i + 1} of ${myThemes.length}: ${t.name}...`);
			const count = themeStats ? toCount(themeStats[t.name]) : null;
			currentRepo = t.repo;
			themes.push({
				kind: 'theme',
				name: t.name,
				id: t.repo,
				repo: t.repo,
				downloads: count,
				source: count !== null ? 'file' : 'na',
				versions: [],
				stars: await stars(t.repo),
			});
		}
	}

	const repos: Row[] = [];
	for (const [i, repo] of missing.entries()) {
		onProgress(`Checking repository ${i + 1} of ${missing.length}: ${repo}...`);
		currentRepo = repo;
		const counted = await fromGitHub(async () => sumReleaseFiles(await githubReleases(repo, token)));
		repos.push({
			kind: 'repo',
			name: repo.slice(repo.indexOf('/') + 1),
			id: repo,
			repo,
			downloads: counted ? counted.total : null,
			source: counted ? 'assets' : 'na',
			versions: counted ? counted.versions : [],
			stars: notFound.has(repo) ? null : await stars(repo),
		});
	}
	if (notFound.size > 0) notices.push(`Not found on GitHub, or private: ${[...notFound].join(', ')}.`);

	const starsNote =
		withStars || repos.length > 0 ? ' Stars and other repositories that could not be loaded show as n/a.' : '';
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
		query: queryKey(usernames, extraRepos, withStars),
		plugins: sortRows(plugins),
		themes: sortRows(themes),
		repos: sortRows(repos),
		notices,
	};
}
