import { App, PluginSettingTab, SecretComponent, Setting, SettingDefinitionItem, setIcon } from 'obsidian';
import { languageDatePattern } from './dates';
import type DownloadTrackerPlugin from './main';

export interface DownloadTrackerSettings {
	usernames: string;
	extraRepos: string;
	tokenSecret: string;
	refreshOnStartup: boolean;
	cacheMinutes: number;
	exportPath: string;
	showVersions: boolean;
	showStars: boolean;
	showFirstRelease: boolean;
	showLastUpdated: boolean;
	dateFormat: string;
	showAllRepos: boolean;
	showIssues: boolean;
	showPulls: boolean;
	dailySnapshot: boolean;
	linkNames: boolean;
}

export const DEFAULT_SETTINGS: DownloadTrackerSettings = {
	usernames: '',
	extraRepos: '',
	tokenSecret: '',
	refreshOnStartup: false,
	cacheMinutes: 30,
	exportPath: 'Download history.md',
	showVersions: false,
	showStars: false,
	showFirstRelease: false,
	showLastUpdated: false,
	dateFormat: '',
	showAllRepos: false,
	showIssues: false,
	showPulls: false,
	dailySnapshot: false,
	linkNames: true,
};

const REPO = 'https://github.com/anthonyfitzpatrick/obsidian-download-tracker';

// The About footer shared with the other Wolf 359 Press plugins.
const ABOUT_LINKS: { icon?: string; cls?: string; label: string; url: string; primary?: boolean }[] = [
	{
		icon: 'bug',
		label: 'Report a bug',
		primary: true,
		url: `${REPO}/issues/new?template=bug_report.yml&title=%5BBug+report%5D%3A+&labels=bug`,
	},
	{
		icon: 'lightbulb',
		label: 'Request a feature',
		primary: true,
		url: `${REPO}/issues/new?template=feature_request.yml&title=%5BFeature+request%5D%3A+&labels=enhancement`,
	},
	{ icon: 'user-round', label: 'Anthony Fitzpatrick', primary: true, url: 'https://anthonyfitzpatrick.me/' },
	{ icon: 'globe', label: 'wolf359.app', url: 'https://wolf359.app/' },
	{ icon: 'book-open', label: 'wolf359.press', url: 'https://wolf359.press/' },
	{ cls: 'download-tracker-about-coffee', label: 'Buy me a coffee', url: 'https://buymeacoffee.com/wolf359pressab' },
];

// Changing these alters what a refresh fetches, so they fetch again straight away.
const REFETCH = new Set<string>(['showStars', 'showFirstRelease', 'showLastUpdated', 'showAllRepos', 'showIssues', 'showPulls']);

function isSettingKey(key: string): key is keyof DownloadTrackerSettings {
	return key in DEFAULT_SETTINGS;
}

export class DownloadTrackerSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: DownloadTrackerPlugin,
	) {
		super(app, plugin);
	}

	// Obsidian draws the tab from these definitions and indexes them for settings search.
	getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = this.plugin.settings;
		return [
			{
				type: 'group',
				heading: 'Accounts',
				items: [
					{
						name: 'GitHub usernames',
						desc: 'Accounts whose plugins and themes are counted. Separate names with commas.',
						control: { type: 'text', key: 'usernames', placeholder: 'Username' },
					},
					{
						name: 'Extra repositories',
						desc: "Other repositories to count, one owner/repo per line. Plugins and themes in Obsidian's community lists are counted as usual. Any other repository is listed under other repositories and counted by the downloads of every file attached to its releases.",
						control: { type: 'textarea', key: 'extraRepos', placeholder: 'Owner/repo' },
					},
					{
						name: 'GitHub token',
						desc: "Optional. Raises GitHub's limit of 60 requests an hour. A token with no scopes is enough. It is kept in Obsidian's secret storage, not in this plugin's data file, and is sent only to GitHub's API.",
						render: (setting: Setting) => {
							setting.addComponent((el) =>
								new SecretComponent(this.app, el).setValue(settings.tokenSecret).onChange(async (value) => {
									settings.tokenSecret = value;
									await this.plugin.saveSettings();
								}),
							);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Updates and snapshots',
				items: [
					{
						name: 'Refresh on startup',
						desc: 'Fetch counts when Obsidian starts, unless the saved counts are newer than the cache duration.',
						control: { type: 'toggle', key: 'refreshOnStartup' },
					},
					{
						name: 'Save a snapshot each day',
						desc: 'The first time counts are fetched each day, save them as a snapshot. Themes and other repositories have no published history, so this is how their lines in the charts grow. It only runs while Obsidian is open; turn on refresh on startup to catch each day you use Obsidian.',
						control: { type: 'toggle', key: 'dailySnapshot' },
					},
					{
						name: 'Cache duration',
						desc: 'Minutes to reuse fetched counts before opening the dashboard fetches them again. The refresh command always fetches.',
						control: {
							type: 'number',
							key: 'cacheMinutes',
							min: 0,
							step: 1,
							validate: (value) => (Number.isFinite(value) && value >= 0 ? undefined : 'Enter 0 or more minutes.'),
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Dashboard',
				items: [
					{
						name: 'Show downloads by version',
						desc: 'List each released version under its plugin or theme on the dashboard.',
						control: { type: 'toggle', key: 'showVersions' },
					},
					{
						name: 'Show stars',
						desc: 'Add a column with the GitHub stars of each repository. This makes one more GitHub request per plugin and theme on each refresh.',
						control: { type: 'toggle', key: 'showStars' },
					},
					{
						name: 'Show initial release date',
						desc: 'Add a column with the date of the first published GitHub release.',
						control: { type: 'toggle', key: 'showFirstRelease' },
					},
					{
						name: 'Show last updated date',
						desc: "Add a column with the date of the latest published GitHub release. If GitHub can't be reached, plugins use the date in Obsidian's stats file.",
						control: { type: 'toggle', key: 'showLastUpdated' },
					},
					{
						name: 'Show all repositories and visibility',
						desc: 'List every repository owned by your GitHub usernames, not only plugins and themes, and tag each one public or private. Forks are left out. Private repositories appear only if the GitHub token belongs to that account and can read them. Each repository adds at least one GitHub request to each refresh.',
						control: { type: 'toggle', key: 'showAllRepos' },
					},
					{
						name: 'Show open issues',
						desc: 'Add a column with the number of open issues in each repository, not counting pull requests. Repositories with open issues or pull requests add a GitHub request to each refresh. Private repositories need a token that can read their issues.',
						control: { type: 'toggle', key: 'showIssues' },
					},
					{
						name: 'Show open pull requests',
						desc: 'Add a column with the number of open pull requests in each repository. Repositories with open issues or pull requests add a GitHub request to each refresh. Private repositories need a token that can read their pull requests.',
						control: { type: 'toggle', key: 'showPulls' },
					},
					{
						name: 'Link names to repositories',
						desc: 'Make each name on the dashboard a link that opens the repository on GitHub.',
						control: { type: 'toggle', key: 'linkNames' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Dates and export',
				items: [
					{
						name: 'Date format',
						desc: "A moment.js pattern such as DD-MM-YYYY. Leave empty to follow Obsidian's language.",
						// Drawn here rather than as a plain control so the example updates as you type.
						render: (setting: Setting) => {
							const describe = () =>
								setting.setDesc(
									`A moment.js pattern such as DD-MM-YYYY. Leave empty to follow Obsidian's language. Today shows as ${this.plugin.displayDate(Date.now())}.`,
								);
							describe();
							setting.addText((text) =>
								text
									.setPlaceholder(languageDatePattern())
									.setValue(settings.dateFormat)
									.onChange(async (value) => {
										settings.dateFormat = value;
										await this.plugin.saveSettings();
										describe();
									}),
							);
						},
					},
					{
						name: 'Export note',
						desc: 'Path of the note the snapshot history is written to. The note is replaced each time you export.',
						control: { type: 'text', key: 'exportPath', placeholder: DEFAULT_SETTINGS.exportPath },
					},
				],
			},
			{
				// Not a setting, so it is left out of search and takes over its row.
				name: 'About Download Tracker',
				searchable: false,
				render: (setting: Setting) => {
					setting.settingEl.empty();
					setting.settingEl.addClass('download-tracker-about-row');
					this.about(setting.settingEl);
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		return isSettingKey(key) ? this.plugin.settings[key] : undefined;
	}

	// Saved through the plugin, which keeps snapshots and history in the same file;
	// the default would write the settings alone.
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!isSettingKey(key)) return;
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		settings[key] = key === 'exportPath' && typeof value === 'string' ? value.trim() : value;
		await this.plugin.saveSettings();
		if (REFETCH.has(key)) void this.plugin.refresh(false);
	}

	private about(containerEl: HTMLElement): void {
		const footer = containerEl.createDiv({ cls: 'download-tracker-about' });
		const identity = footer.createDiv({ cls: 'download-tracker-about-identity' });
		logo(identity);
		const text = identity.createDiv();
		text.createDiv({ text: 'Download Tracker', cls: 'download-tracker-about-title' });
		text.createDiv({ text: `Version ${this.plugin.manifest.version}`, cls: 'download-tracker-about-detail' });
		text.createDiv({ text: 'Created by Anthony Fitzpatrick', cls: 'download-tracker-about-detail' });
		text.createDiv({ text: 'Wolf 359 Press AB', cls: 'download-tracker-about-detail' });

		const links = footer.createDiv({ cls: 'download-tracker-about-links' });
		const primary = links.createDiv({ cls: 'download-tracker-about-row' });
		const secondary = links.createDiv({ cls: 'download-tracker-about-row' });
		for (const link of ABOUT_LINKS) {
			// Buttons, as in the other Wolf 359 Press plugins, so themes style them alike.
			const el = (link.primary ? primary : secondary).createEl('button', {
				cls: 'download-tracker-about-link' + (link.cls ? ` ${link.cls}` : ''),
				attr: { type: 'button', 'aria-label': `${link.label}: ${link.url}` },
			});
			const icon = el.createSpan({ cls: 'download-tracker-about-icon', attr: { 'aria-hidden': 'true' } });
			if (link.icon) setIcon(icon, link.icon);
			el.createSpan({ text: link.label });
			// Obsidian opens window.open targets in the default browser.
			el.addEventListener('click', () => window.open(link.url, '_blank', 'noopener'));
		}
	}
}

// The plugin's mark, drawn in place: a community install ships no image files.
function logo(parent: HTMLElement): void {
	const box = parent.createDiv({ cls: 'download-tracker-about-logo', attr: { role: 'img', 'aria-label': 'Download Tracker logo' } });
	const svg = box.createSvg('svg', { attr: { viewBox: '0 0 512 512', 'aria-hidden': 'true' } });
	svg.createSvg('rect', { attr: { width: '512', height: '512', rx: '96', fill: '#FFFFFF' } });
	const g = svg.createSvg('g', {
		attr: {
			transform: 'translate(112 112) scale(12)',
			fill: 'none',
			stroke: '#1F2937',
			'stroke-width': '1.5',
			'stroke-linecap': 'round',
			'stroke-linejoin': 'round',
		},
	});
	g.createSvg('path', { attr: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', fill: '#EDE9FE' } });
	g.createSvg('path', { attr: { d: 'M7 10l5 5 5-5', stroke: '#7C3AED' } });
	g.createSvg('path', { attr: { d: 'M12 15V3', stroke: '#7C3AED' } });
}
