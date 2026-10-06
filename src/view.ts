import { ItemView, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { renderCharts } from './charts';
import {
	KIND_LABELS,
	Row,
	SOURCE_LABELS,
	Snapshot,
	delta,
	formatCount,
	formatDelta,
	previousSnapshot,
	repoUrl,
	sumKnown,
	total,
} from './counts';
import type DownloadTrackerPlugin from './main';

export const VIEW_TYPE = 'download-tracker-dashboard';

const NUMERIC = new Set(['Downloads', 'Change', 'Stars', 'Open issues', 'Open pull requests']);
const DATES = new Set(['Initial release', 'Last updated']);
const VISIBILITY_LABELS = { public: 'Public', private: 'Private' };

type Tab = 'tables' | 'charts';
const TABS: { id: Tab; label: string }[] = [
	{ id: 'tables', label: 'Tables' },
	{ id: 'charts', label: 'Charts' },
];

export class DashboardView extends ItemView {
	private refreshButton!: HTMLButtonElement;
	private saveButton!: HTMLButtonElement;
	private bodyEl: HTMLElement | null = null;
	private tab: Tab = 'tables';

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

	// Saved with the workspace, so the dashboard reopens on the tab last used.
	getState(): Record<string, unknown> {
		return { ...super.getState(), tab: this.tab };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const tab = (state as { tab?: unknown } | null)?.tab;
		if (tab === 'tables' || tab === 'charts') this.tab = tab;
		await super.setState(state, result);
		this.render();
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
		const tiles = root.createDiv({ cls: 'download-tracker-tiles' });
		this.tile(tiles, formatCount(total([...report.plugins, ...report.themes])), 'Plugins and themes');
		this.tile(tiles, formatCount(total(report.plugins)), `Plugins (${report.plugins.length})`);
		this.tile(tiles, formatCount(total(report.themes)), `Themes (${report.themes.length})`);
		if (report.repos.length > 0) {
			this.tile(tiles, formatCount(sumKnown(report.repos.map((r) => r.downloads))), `Other repositories (${report.repos.length})`);
		}

		const tabBar = root.createDiv({ cls: 'download-tracker-tabs', attr: { role: 'tablist' } });
		for (const { id, label } of TABS) {
			// Not a <button>: themes restyle buttons, which can hide the label of a plain tab.
			const tabEl = tabBar.createDiv({
				text: label,
				cls: 'download-tracker-tab' + (id === this.tab ? ' is-active' : ''),
				attr: { role: 'tab', tabindex: '0', 'aria-selected': String(id === this.tab) },
			});
			const select = () => {
				if (this.tab === id) return;
				this.tab = id;
				this.app.workspace.requestSaveLayout();
				this.render();
				this.bodyEl?.querySelector<HTMLElement>('.download-tracker-tab.is-active')?.focus();
			};
			tabEl.addEventListener('click', select);
			tabEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					select();
				}
			});
		}

		if (this.tab === 'charts') {
			renderCharts(root.createDiv({ attr: { role: 'tabpanel' } }), report, this.plugin.snapshots, previous, (t, withTime) =>
				this.plugin.displayDate(t, withTime),
			);
			return;
		}

		this.table(root, 'Published Obsidian plugins', report.plugins, previous, 'No plugins from these accounts are in the community plugin list.');
		this.table(root, 'Published Obsidian themes', report.themes, previous, 'No themes from these accounts are in the community theme list.');
		if (report.repos.length > 0) {
			this.table(root, 'Other repositories', report.repos, previous, '');
			root.createEl('p', {
				text: 'Other repositories are counted by every file attached to their GitHub releases, so one person downloading three files counts three times. They are not in the plugins and themes total.',
				cls: 'download-tracker-meta',
			});
		}

		const meta = root.createEl('p', { cls: 'download-tracker-meta' });
		meta.setText(
			`Counts fetched ${this.plugin.displayDate(report.fetchedAt, true)}. ` +
				(previous
					? `Change compares with the snapshot from ${this.plugin.displayDate(previous.fetchedAt, true)}.`
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
		const { showStars, showFirstRelease, showLastUpdated, showAllRepos, showIssues, showPulls, linkNames } =
			this.plugin.settings;
		const columns = [
			'Type',
			'Name',
			'ID or repo',
			'Downloads',
			'Change',
			'Source',
			...(showAllRepos ? ['Visibility'] : []),
			...(showStars ? ['Stars'] : []),
			...(showIssues ? ['Open issues'] : []),
			...(showPulls ? ['Open pull requests'] : []),
			...(showFirstRelease ? ['Initial release'] : []),
			...(showLastUpdated ? ['Last updated'] : []),
		];
		const head = table.createEl('thead').createEl('tr');
		for (const col of columns) head.createEl('th', { text: col, cls: this.columnClass(col) });

		const body = table.createEl('tbody');
		if (rows.length === 0) {
			body.createEl('tr').createEl('td', { text: empty, attr: { colspan: String(columns.length) } });
		}
		for (const row of rows) {
			const tr = body.createEl('tr');
			this.cells(tr, columns, [
				KIND_LABELS[row.kind],
				row.name,
				row.kind === 'plugin' ? row.id : row.repo,
				formatCount(row.downloads),
				formatDelta(delta(row, previous)),
				SOURCE_LABELS[row.source],
				...(showAllRepos ? [row.visibility ? VISIBILITY_LABELS[row.visibility] : 'n/a'] : []),
				...(showStars ? [formatCount(row.stars)] : []),
				...(showIssues ? [formatCount(row.openIssues)] : []),
				...(showPulls ? [formatCount(row.openPulls)] : []),
				...(showFirstRelease ? [this.plugin.displayDate(row.firstRelease)] : []),
				...(showLastUpdated ? [this.plugin.displayDate(row.lastUpdated)] : []),
			]);
			if (linkNames) {
				const nameCell = tr.children[1];
				nameCell?.empty();
				nameCell?.createEl('a', { text: row.name, href: repoUrl(row.repo), attr: { target: '_blank', rel: 'noopener' } });
			}
			if (this.plugin.settings.showVersions) {
				for (const v of row.versions) {
					const tr = body.createEl('tr', { cls: 'download-tracker-version' });
					this.cells(tr, columns, ['', `Version ${v.version}`, '', formatCount(v.downloads)]);
				}
			}
		}
		const sub = body.createEl('tr', { cls: 'download-tracker-subtotal' });
		const downloads = sumKnown(rows.map((r) => r.downloads));
		const stars = sumKnown(rows.map((r) => r.stars));
		this.cells(sub, columns, [
			'',
			'Subtotal',
			'',
			formatCount(downloads),
			'',
			'',
			...(showAllRepos ? [''] : []),
			...(showStars ? [formatCount(stars)] : []),
			...(showIssues ? [formatCount(sumKnown(rows.map((r) => r.openIssues)))] : []),
			...(showPulls ? [formatCount(sumKnown(rows.map((r) => r.openPulls)))] : []),
		]);
	}

	private cells(tr: HTMLElement, columns: string[], values: string[]): void {
		columns.forEach((col, i) => {
			const value = values[i] ?? '';
			const td = tr.createEl('td', { cls: this.columnClass(col) });
			if (col === 'Visibility' && (value === 'Public' || value === 'Private')) {
				td.createSpan({ text: value, cls: `download-tracker-tag is-${value.toLowerCase()}` });
			} else {
				td.setText(value);
			}
		});
	}

	private columnClass(col: string): string {
		return NUMERIC.has(col) ? 'is-number' : DATES.has(col) ? 'is-date' : '';
	}
}
