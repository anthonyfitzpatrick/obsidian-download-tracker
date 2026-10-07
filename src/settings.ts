import { App, PluginSettingTab, SecretComponent, Setting, moment } from 'obsidian';
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

// Fill these in before release. A link is shown only when its URL is set.
const COFFEE_URL = 'https://buymeacoffee.com/wolf359pressab';
const BOOK_URL = '';

export class DownloadTrackerSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: DownloadTrackerPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName('GitHub usernames')
			.setDesc('Accounts whose plugins and themes are counted. Separate names with commas.')
			.addText((text) =>
				text
					.setPlaceholder('Username')
					.setValue(settings.usernames)
					.onChange(async (value) => {
						settings.usernames = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Extra repositories')
			.setDesc('Other repositories to count, one owner/repo per line. Plugins and themes in Obsidian\'s community lists are counted as usual. Any other repository is listed under other repositories and counted by the downloads of every file attached to its releases.')
			.addTextArea((text) =>
				text
					.setPlaceholder('Owner/repo')
					.setValue(settings.extraRepos)
					.onChange(async (value) => {
						settings.extraRepos = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('GitHub token')
			.setDesc(
				"Optional. Raises GitHub's limit of 60 requests an hour. A token with no scopes is enough. It is kept in Obsidian's secret storage, not in this plugin's data file, and is sent only to GitHub's API.",
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(settings.tokenSecret).onChange(async (value) => {
					settings.tokenSecret = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Refresh on startup')
			.setDesc('Fetch counts when Obsidian starts, unless the saved counts are newer than the cache duration.')
			.addToggle((toggle) =>
				toggle.setValue(settings.refreshOnStartup).onChange(async (value) => {
					settings.refreshOnStartup = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Save a snapshot each day')
			.setDesc(
				'The first time counts are fetched each day, save them as a snapshot. Themes and other repositories have no published history, so this is how their lines in the charts grow. It only runs while Obsidian is open; turn on refresh on startup to catch each day you use Obsidian.',
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.dailySnapshot).onChange(async (value) => {
					settings.dailySnapshot = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Cache duration')
			.setDesc('Minutes to reuse fetched counts before opening the dashboard fetches them again. The refresh command always fetches.')
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
				text.setValue(String(settings.cacheMinutes)).onChange(async (value) => {
					const minutes = Number(value);
					if (value.trim() === '' || !Number.isFinite(minutes) || minutes < 0) return;
					settings.cacheMinutes = minutes;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Show downloads by version')
			.setDesc('List each released version under its plugin on the dashboard.')
			.addToggle((toggle) =>
				toggle.setValue(settings.showVersions).onChange(async (value) => {
					settings.showVersions = value;
					await this.plugin.saveSettings();
					this.plugin.renderViews();
				}),
			);

		new Setting(containerEl)
			.setName('Show stars')
			.setDesc('Add a column with the GitHub stars of each repository. This makes one more GitHub request per plugin and theme on each refresh.')
			.addToggle((toggle) =>
				toggle.setValue(settings.showStars).onChange(async (value) => {
					settings.showStars = value;
					await this.plugin.saveSettings();
					if (value) void this.plugin.refresh(false);
				}),
			);

		new Setting(containerEl)
			.setName('Show initial release date')
			.setDesc('Add a column with the date of the first published GitHub release.')
			.addToggle((toggle) =>
				toggle.setValue(settings.showFirstRelease).onChange(async (value) => {
					settings.showFirstRelease = value;
					await this.plugin.saveSettings();
					void this.plugin.refresh(false);
				}),
			);

		new Setting(containerEl)
			.setName('Show last updated date')
			.setDesc("Add a column with the date of the latest published GitHub release. If GitHub can't be reached, plugins use the date in Obsidian's stats file.")
			.addToggle((toggle) =>
				toggle.setValue(settings.showLastUpdated).onChange(async (value) => {
					settings.showLastUpdated = value;
					await this.plugin.saveSettings();
					void this.plugin.refresh(false);
				}),
			);

		new Setting(containerEl)
			.setName('Show all repositories and visibility')
			.setDesc(
				'List every repository owned by your GitHub usernames, not only plugins and themes, and tag each one public or private. Forks are left out. Private repositories appear only if the GitHub token belongs to that account and can read them. Each repository adds at least one GitHub request to each refresh.',
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.showAllRepos).onChange(async (value) => {
					settings.showAllRepos = value;
					await this.plugin.saveSettings();
					void this.plugin.refresh(false);
				}),
			);

		new Setting(containerEl)
			.setName('Show open issues')
			.setDesc(
				'Add a column with the number of open issues in each repository, not counting pull requests. Repositories with open issues or pull requests add a GitHub request to each refresh. Private repositories need a token that can read their issues.',
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.showIssues).onChange(async (value) => {
					settings.showIssues = value;
					await this.plugin.saveSettings();
					void this.plugin.refresh(false);
				}),
			);

		new Setting(containerEl)
			.setName('Show open pull requests')
			.setDesc(
				'Add a column with the number of open pull requests in each repository. Repositories with open issues or pull requests add a GitHub request to each refresh. Private repositories need a token that can read their pull requests.',
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.showPulls).onChange(async (value) => {
					settings.showPulls = value;
					await this.plugin.saveSettings();
					void this.plugin.refresh(false);
				}),
			);

		new Setting(containerEl)
			.setName('Link names to repositories')
			.setDesc("Make each name on the dashboard a link that opens the repository on GitHub.")
			.addToggle((toggle) =>
				toggle.setValue(settings.linkNames).onChange(async (value) => {
					settings.linkNames = value;
					await this.plugin.saveSettings();
				}),
			);

		const dateSetting = new Setting(containerEl).setName('Date format');
		const describeDate = () => {
			const example = this.plugin.displayDate(Date.now());
			dateSetting.setDesc(
				`A moment.js pattern such as DD-MM-YYYY. Leave empty to follow Obsidian's language. Today shows as ${example}.`,
			);
		};
		describeDate();
		dateSetting.addText((text) =>
			text
				.setPlaceholder(moment().localeData().longDateFormat('ll'))
				.setValue(settings.dateFormat)
				.onChange(async (value) => {
					settings.dateFormat = value;
					await this.plugin.saveSettings();
					describeDate();
				}),
		);

		new Setting(containerEl)
			.setName('Export note')
			.setDesc('Path of the note the snapshot history is written to. The note is replaced each time you export.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.exportPath)
					.setValue(settings.exportPath)
					.onChange(async (value) => {
						settings.exportPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		const footer = containerEl.createDiv({ cls: 'download-tracker-credit' });
		footer.createSpan({ text: 'Created by Anthony Fitzpatrick at Wolf 359 Press.' });
		if (COFFEE_URL) {
			footer.createSpan({ text: ' ' });
			footer.createEl('a', { text: 'Buy me a coffee', href: COFFEE_URL });
		}
		if (BOOK_URL) {
			footer.createSpan({ text: ' ' });
			footer.createEl('a', { text: 'My books', href: BOOK_URL });
		}
	}
}
