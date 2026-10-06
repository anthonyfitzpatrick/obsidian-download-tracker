import { ItemView, WorkspaceLeaf } from 'obsidian';
import {
	Row,
	SOURCE_LABELS,
	Snapshot,
	delta,
	formatCount,
	formatDate,
	formatDelta,
	previousSnapshot,
	total,
} from './counts';
import type DownloadTrackerPlugin from './main';

export const VIEW_TYPE = 'download-tracker-dashboard';

const COLUMNS = ['Type', 'Name', 'ID or repo', 'Downloads', 'Change', 'Source'];
const NUMERIC = new Set(['Downloads', 'Change']);

export class DashboardView extends ItemView {
	private refreshButton!: HTMLButtonElement;
	private saveButton!: HTMLButtonElement;
	private bodyEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: DownloadTrackerPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Download tracker';
	}

	getIcon(): string {
		return 'download';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('download-tracker');
		const bar = this.contentEl.createDiv({ cls: 'download-tracker-bar' });
		this.refreshButton = bar.createEl('button', { text: 'Refresh', cls: 'mod-cta' });
		this.registerDomEvent(this.refreshButton, 'click', () => void this.plugin.refresh(true));
		this.saveButton = bar.createEl('button', { text: 'Save snapshot' });
		this.registerDomEvent(this.saveButton, 'click', () => void this.plugin.saveSnapshot());
		this.bodyEl = this.contentEl.createDiv();

		this.render();
		await this.plugin.ensureReport();
	}

	render(): void {
		if (!this.bodyEl) return;
		this.refreshButton.disabled = this.plugin.loading;
		this.saveButton.disabled = this.plugin.loading || !this.plugin.report;
		const root = this.bodyEl;
		root.empty();

		const status = root.createDiv({ cls: 'download-tracker-status' });
		if (this.plugin.loading) status.setText(this.plugin.progress);
		else if (this.plugin.error) {
			status.setText(this.plugin.error);
			status.addClass('mod-warning');
		}

		if (!this.plugin.hasAccounts()) {
			root.createEl('p', {
				text: 'Add your GitHub username in this plugin\'s settings to see download counts.',
				cls: 'download-tracker-empty',
			});
			return;
		}

		const report = this.plugin.report;
		if (!report) {
			if (!this.plugin.loading && !this.plugin.error) root.createEl('p', { text: 'Refresh to load counts.', cls: 'download-tracker-empty' });
			return;
		}

		for (const notice of report.notices) {
			root.createDiv({ text: notice, cls: 'download-tracker-notice' });
		}

		const previous = previousSnapshot(this.plugin.snapshots, report.fetchedAt);
		const all = [...report.plugins, ...report.themes];

		const tiles = root.createDiv({ cls: 'download-tracker-tiles' });
		this.tile(tiles, formatCount(total(all)), 'Total downloads');
		this.tile(tiles, formatCount(total(report.plugins)), `Plugins (${report.plugins.length})`);
		this.tile(tiles, formatCount(total(report.themes)), `Themes (${report.themes.length})`);

		this.table(root, 'Plugins', report.plugins, previous, 'No plugins from these accounts are in the community plugin list.');
		this.table(root, 'Themes', report.themes, previous, 'No themes from these accounts are in the community theme list.');

		const meta = root.createEl('p', { cls: 'download-tracker-meta' });
		meta.setText(
			`Counts fetched ${formatDate(report.fetchedAt)}. ` +
				(previous
					? `Change compares with the snapshot from ${formatDate(previous.fetchedAt)}.`
					: 'Change shows n/a until a snapshot of earlier counts is saved.'),
		);
	}

	private tile(parent: HTMLElement, value: string, label: string): void {
		const tile = parent.createDiv({ cls: 'download-tracker-tile' });
		tile.createDiv({ text: value, cls: 'download-tracker-tile-value' });
		tile.createDiv({ text: label, cls: 'download-tracker-tile-label' });
	}

	private table(parent: HTMLElement, title: string, rows: Row[], previous: Snapshot | undefined, empty: string): void {
		parent.createEl('h4', { text: title });
		const wrap = parent.createDiv({ cls: 'download-tracker-table-wrap' });
		const table = wrap.createEl('table', { cls: 'download-tracker-table' });
		const head = table.createEl('thead').createEl('tr');
		for (const col of COLUMNS) head.createEl('th', { text: col, cls: NUMERIC.has(col) ? 'is-number' : '' });

		const body = table.createEl('tbody');
		if (rows.length === 0) {
			body.createEl('tr').createEl('td', { text: empty, attr: { colspan: String(COLUMNS.length) } });
		}
		for (const row of rows) {
			this.cells(body.createEl('tr'), [
				row.kind === 'plugin' ? 'Plugin' : 'Theme',
				row.name,
				row.kind === 'plugin' ? row.id : row.repo,
				formatCount(row.downloads),
				formatDelta(delta(row, previous)),
				SOURCE_LABELS[row.source],
			]);
			if (this.plugin.settings.showVersions) {
				for (const v of row.versions) {
					const tr = body.createEl('tr', { cls: 'download-tracker-version' });
					this.cells(tr, ['', `Version ${v.version}`, '', formatCount(v.downloads), '', '']);
				}
			}
		}
		const sub = body.createEl('tr', { cls: 'download-tracker-subtotal' });
		this.cells(sub, ['', 'Subtotal', '', formatCount(total(rows)), '', '']);
	}

	private cells(tr: HTMLElement, values: string[]): void {
		values.forEach((value, i) => {
			tr.createEl('td', { text: value, cls: NUMERIC.has(COLUMNS[i] ?? '') ? 'is-number' : '' });
		});
	}
}
