import { Editor, Notice, Plugin, moment, normalizePath } from 'obsidian';
import {
	Row,
	Snapshot,
	formatDate,
	historyTable,
	makeSnapshot,
	parseList,
	previousSnapshot,
	summaryTable,
	summaryText,
} from './counts';
import { Report, ReportOptions, loadReport, queryKey } from './fetch';
import { DEFAULT_SETTINGS, DownloadTrackerSettingTab, DownloadTrackerSettings } from './settings';
import { DashboardView, VIEW_TYPE } from './view';

interface StoredData {
	settings: DownloadTrackerSettings;
	report: Report | null;
	snapshots: Snapshot[];
}

const NO_ACCOUNTS = "Add your GitHub username in this plugin's settings to see download counts.";

export default class DownloadTrackerPlugin extends Plugin {
	settings: DownloadTrackerSettings = { ...DEFAULT_SETTINGS };
	snapshots: Snapshot[] = [];
	loading = false;
	progress = '';
	error = '';
	private storedReport: Report | null = null;
	private pending: Promise<void> | null = null;
	private pendingQuery = '';

	async onload(): Promise<void> {
		const data = (await this.loadData()) as Partial<StoredData> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...data?.settings };
		this.storedReport = data?.report ?? null;
		this.snapshots = data?.snapshots ?? [];

		this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
		this.addRibbonIcon('download', 'Open download tracker', () => void this.openDashboard());
		this.addSettingTab(new DownloadTrackerSettingTab(this.app, this));

		this.addCommand({ id: 'open-dashboard', name: 'Open dashboard', callback: () => void this.openDashboard() });
		this.addCommand({ id: 'refresh-counts', name: 'Refresh counts', callback: () => void this.refresh(true) });
		this.addCommand({ id: 'save-snapshot', name: 'Save snapshot', callback: () => void this.saveSnapshot() });
		this.addCommand({
			id: 'export-history',
			name: 'Export snapshot history to note',
			callback: () => void this.exportHistory(),
		});
		this.addCommand({ id: 'copy-summary', name: 'Copy summary to clipboard', callback: () => void this.copySummary() });
		this.addCommand({
			id: 'insert-summary',
			name: 'Insert summary table',
			editorCallback: (editor) => void this.insertSummary(editor),
		});

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.refreshOnStartup) void this.refresh(false);
		});
	}

	get report(): Report | null {
		const r = this.storedReport;
		return r && r.query === this.query() ? r : null;
	}

	// Obsidian sets moment's locale from its language, so 'll' and 'lll' follow it.
	displayDate(time: number | null, withTime = false): string {
		if (time === null) return 'n/a';
		const pattern = this.settings.dateFormat.trim();
		if (!pattern) return moment(time).format(withTime ? 'lll' : 'll');
		return moment(time).format(withTime ? `${pattern} HH:mm` : pattern);
	}

	hasAccounts(): boolean {
		return parseList(this.settings.usernames).length + parseList(this.settings.extraRepos).length > 0;
	}

	private options(): ReportOptions {
		const s = this.settings;
		return {
			usernames: parseList(s.usernames),
			extraRepos: parseList(s.extraRepos),
			withStars: s.showStars,
			withThemeDates: s.showFirstRelease || s.showLastUpdated,
			withAllRepos: s.showAllRepos,
			withIssues: s.showIssues,
			withPulls: s.showPulls,
		};
	}

	private query(): string {
		return queryKey(this.options());
	}

	async saveSettings(): Promise<void> {
		await this.saveStoredData();
		this.renderViews();
	}

	private async saveStoredData(): Promise<void> {
		const data: StoredData = { settings: this.settings, report: this.storedReport, snapshots: this.snapshots };
		await this.saveData(data);
	}

	renderViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof DashboardView) leaf.view.render();
		}
	}

	async openDashboard(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	ensureReport(): Promise<void> {
		return this.refresh(false);
	}

	refresh(force: boolean): Promise<void> {
		if (this.pending) {
			if (this.pendingQuery === this.query()) return this.pending;
			return this.pending.then(() => this.refresh(force));
		}
		if (!this.hasAccounts()) {
			this.renderViews();
			return Promise.resolve();
		}
		const report = this.report;
		const maxAge = this.settings.cacheMinutes * 60_000;
		if (!force && report && Date.now() - report.fetchedAt < maxAge) return Promise.resolve();

		this.pendingQuery = this.query();
		this.pending = this.fetchReport().finally(() => {
			this.pending = null;
		});
		return this.pending;
	}

	private async fetchReport(): Promise<void> {
		this.loading = true;
		this.error = '';
		this.progress = 'Loading...';
		this.renderViews();
		try {
			const token = this.settings.tokenSecret
				? (this.app.secretStorage.getSecret(this.settings.tokenSecret) ?? '')
				: '';
			this.storedReport = await loadReport(this.options(), token, (message) => {
				this.progress = message;
				this.renderViews();
			});
			await this.saveStoredData();
		} catch {
			const report = this.report;
			this.error = report
				? `Could not reach GitHub, so these are the counts from ${this.displayDate(report.fetchedAt, true)}. Check your connection and refresh.`
				: 'Could not reach GitHub. Check your connection and refresh.';
		} finally {
			this.loading = false;
			this.renderViews();
		}
	}

	private async requireReport(): Promise<Report | null> {
		await this.ensureReport();
		const report = this.report;
		if (!report) new Notice(this.hasAccounts() ? this.error || 'No counts loaded.' : NO_ACCOUNTS);
		return report;
	}

	private rows(report: Report): Row[] {
		return [...report.plugins, ...report.themes];
	}

	async saveSnapshot(): Promise<void> {
		const report = await this.requireReport();
		if (!report) return;
		if (this.snapshots.some((s) => s.fetchedAt === report.fetchedAt)) {
			new Notice('These counts are already in a snapshot. Refresh to fetch new counts first.');
			return;
		}
		const snapshot = makeSnapshot(this.rows(report), report.fetchedAt);
		const size = Object.keys(snapshot.counts).length;
		if (size === 0) {
			new Notice('There are no counts to save.');
			return;
		}
		this.snapshots.push(snapshot);
		await this.saveStoredData();
		this.renderViews();
		new Notice(`Snapshot saved with ${size} counts from ${this.displayDate(report.fetchedAt, true)}.`);
	}

	async exportHistory(): Promise<void> {
		if (this.snapshots.length === 0) {
			new Notice('No snapshots saved yet. Save a snapshot first.');
			return;
		}
		let path = normalizePath(this.settings.exportPath || DEFAULT_SETTINGS.exportPath);
		if (!path.endsWith('.md')) path += '.md';
		const content = `Download counts saved by Download Tracker. Exported ${formatDate(Date.now())}.\n\n${historyTable(this.snapshots)}\n`;

		const { vault } = this.app;
		const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		if (folder && !vault.getFolderByPath(folder)) await vault.createFolder(folder);
		const file = vault.getFileByPath(path);
		if (file) await vault.process(file, () => content);
		else await vault.create(path, content);
		new Notice(`Snapshot history written to ${path}.`);
	}

	async copySummary(): Promise<void> {
		const report = await this.requireReport();
		if (!report) return;
		await navigator.clipboard.writeText(summaryText(this.rows(report), report.fetchedAt));
		new Notice('Summary copied to the clipboard.');
	}

	async insertSummary(editor: Editor): Promise<void> {
		const report = await this.requireReport();
		if (!report) return;
		const previous = previousSnapshot(this.snapshots, report.fetchedAt);
		editor.replaceSelection(summaryTable(this.rows(report), report.fetchedAt, previous) + '\n');
	}
}
