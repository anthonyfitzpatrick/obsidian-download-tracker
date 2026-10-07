# Download Tracker user guide

## Set up

1. Open **Settings → Download Tracker**.
2. Under **GitHub usernames**, enter the account your plugins and themes are published from. For several accounts, separate them with commas.
3. Under **Extra repositories**, add any other repository as `owner/repo`, one per line. A plugin or theme published from another account is counted like your own. Any other repository appears in the other repositories table.
4. Optional: add a GitHub token. Without one, GitHub allows 60 requests an hour, which is enough for a few refreshes of a handful of plugins.
   1. On GitHub, under **Settings → Developer settings → Personal access tokens → Tokens (classic)**, generate a token and leave every scope unticked.
   2. In the **GitHub token** setting, select **Link**, create a new secret and paste the token.

The token is kept in Obsidian's secret storage and is sent only to `api.github.com`.

## Read the dashboard

Open the dashboard with the download icon in the ribbon, or run **Download Tracker: Open dashboard** from the command palette.

The tiles at the top show the combined total for plugins and themes, and each group's total. Below them are the published Obsidian plugins table, the published Obsidian themes table and, if you added repositories that aren't Obsidian plugins or themes, an other repositories table.

| Column | Meaning |
| --- | --- |
| Type | Plugin, theme or repository. |
| Name | The name in Obsidian's community directory, or the repository name. With **Link names to repositories** on (the default), it opens the repository on GitHub. |
| ID or repo | The plugin ID, or the theme's GitHub repository. |
| Downloads | Installs and updates, not people. |
| Change | The difference from your last snapshot, or n/a if there is none to compare with. |
| Source | Where the count came from: GitHub live, GitHub release files, Obsidian stats file, or not available. |
| Stars | The repository's GitHub stars. Shown only when **Show stars** is on. |
| Open issues | Open issues, not counting pull requests. Shown only when **Show open issues** is on. |
| Open pull requests | Open pull requests. Shown only when **Show open pull requests** is on. |
| Initial release | Date of the first published GitHub release. Shown only when **Show initial release date** is on. |
| Last updated | Date of the latest published GitHub release. Shown only when **Show last updated date** is on. |

Counts are reused for the number of minutes set in **Cache duration**, so opening the dashboard again doesn't fetch everything again. Select **Refresh**, or run **Download Tracker: Refresh counts**, to fetch new counts at any time.

Messages above the tiles tell you when something couldn't be loaded. The most common one is GitHub's rate limit. When that happens, the affected plugins show Obsidian's stats file count, which may be a few days old.

Other repositories are counted by every file attached to their GitHub releases, so their numbers mean something different from Obsidian downloads and are not in the plugins and themes total. A repository that doesn't exist or is private shows n/a with a message.

To add a column with each repository's GitHub stars, turn on **Show stars** in settings. This adds one GitHub request per plugin and theme to each refresh, so a token helps if you have many. Stars are not saved in snapshots.

To add release dates, turn on **Show initial release date**, **Show last updated date**, or both. Drafts and pre-releases are not counted. A theme with no GitHub releases shows n/a.

To see every repository you own, turn on **Show all repositories and visibility**. Repositories that aren't Obsidian plugins or themes are added to the other repositories table, and a Visibility column tags every row Public or Private. Forks are left out.

Private repositories need a token that can read them:

1. On GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Set **Repository access** to **All repositories**, or select the ones you want.
3. Under **Repository permissions**, set **Contents** to **Read-only**. To count issues and pull requests in private repositories as well, also set **Issues** and **Pull requests** to **Read-only**. Leave everything else at **No access**.
4. Put the token in the **GitHub token** setting.

Dates follow your Obsidian language unless you set **Date format** to a moment.js pattern, for example `DD-MM-YYYY` for 06-10-2026 or `DD-MMM-YYYY` for 06-Oct-2026. The setting shows today's date in the chosen format. Exported history and summaries always use `YYYY-MM-DD HH:mm`, so the history table sorts by date.

To see the downloads of each released version, turn on **Show downloads by version** in settings. The versions are listed under each plugin, newest first. Themes have no per-version counts.

## Read the charts

The dashboard has two tabs. **Tables** shows the tables described above. **Charts** shows the same counts as charts. The dashboard remembers the tab and the chart filter you last used.

Above the charts is a filter row. Choose **All** (plugins and themes), **Plugins**, **Themes** or **Other repositories**, and type in **Filter by name** to narrow it further. The filter applies to every chart. Each chart has a **How to read this** note you can open. Hover over a bar, column or date, or move to it with the Tab key, to see exact values.

- **Downloads by project.** One line per project, with a point at the end of every week (every month or quarter for longer spans) from your earliest release to today. Plugin points are the real totals Obsidian published at that time: the plugin reads past versions of Obsidian's daily stats file the first time the chart needs them, and shows its progress above the chart. Those figures run a few days behind, so a line can rise at its last point, "Today", which is the live count from the tables. Themes and other repositories have no published history, so their points come from your saved snapshots. Before your first snapshot, their totals are estimated as a straight rise from zero at release to the first recorded value, and drawn as a dashed line with hollow dots; tooltips mark them "estimated". Hover over a name in the legend below the chart to pick out its line, or over a period to see every project's total. Each project keeps its colour whatever the filter; past eight projects, the smallest share one grey "Other" line.
- **Total downloads over time.** On the same weeks (or months) as the chart above, from your earliest release to today. With **All**, three lines: plugins, themes, and both combined in grey; with one type chosen, a single line. Plugins use Obsidian's daily figures and themes use your snapshots, the same as above. A project counts as zero before its first release. Totals that include an estimated theme are dashed too, and the combined line is drawn on top so it stays visible where it runs along the plugin line.

On a narrow pane or a phone, names move above their bars and the charts stack.

## What Obsidian doesn't publish

Obsidian publishes a daily history of plugin downloads, but not of theme downloads. Its theme statistics only ever give today's total. GitHub doesn't keep a history for anyone: a release's download count is a running total with no dates.

What this means in the charts:

- **Plugins** have real totals back to their first appearance in Obsidian's directory.
- **Themes** have real totals only from your first snapshot. Before that, their totals are estimated as a straight rise from zero at release to the first recorded value, and drawn as dashed lines with hollow dots. Tooltips mark these values "estimated". They show the general shape, not what actually happened week by week.
- **Other repositories** work like themes: real totals only from your snapshots.

To build real theme history, turn on **Save a snapshot each day**, and **Refresh on startup** to catch every day you open Obsidian. Each week then gets a recorded point, and the dashed part stops growing. Weeks that have already passed can't be recovered.

## Save a snapshot

Select **Save snapshot** on the dashboard, or run **Download Tracker: Save snapshot**. The counts on screen are saved with the time they were fetched.

After that, the Change column compares the counts with that snapshot. If a count now comes from a different source than in the snapshot, for example because GitHub's rate limit forced the stats file, the change shows n/a. Saving the same counts twice is refused, so refresh first if you want a new snapshot.

Snapshots are stored in the plugin's `data.json`. To save one automatically, turn on **Save a snapshot each day**: the first time counts are fetched each day, they are saved as that day's snapshot. Obsidian publishes no download history for themes or other repositories, so these snapshots are what their lines in the Downloads by project chart are drawn from. It only runs while Obsidian is open, so also turning on **Refresh on startup** catches every day you use Obsidian.

## Export history

Run **Download Tracker: Export snapshot history to note**. The plugin writes a table with one row per snapshot, one column per plugin, theme or repository, and a total for plugins and themes, to the note set in **Export note** (`Download history.md` by default). It creates the folder if needed.

The note is replaced on every export, so keep your own notes about downloads elsewhere.

## Share the current counts

- **Download Tracker: Copy summary to clipboard** copies a plain-text list with the total.
- **Download Tracker: Insert summary table** inserts a Markdown table, with the change since your last snapshot, at the cursor in the current note.
