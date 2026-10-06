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

The tiles at the top show the combined total for plugins and themes, and each group's total. Below them are a plugins table, a themes table and, if you added repositories that aren't Obsidian plugins or themes, an other repositories table.

| Column | Meaning |
| --- | --- |
| Type | Plugin, theme or repository. |
| Name | The name in Obsidian's community directory. |
| ID or repo | The plugin ID, or the theme's GitHub repository. |
| Downloads | Installs and updates, not people. |
| Change | The difference from your last snapshot, or n/a if there is none to compare with. |
| Source | Where the count came from: GitHub live, GitHub release files, Obsidian stats file, or not available. |
| Stars | The repository's GitHub stars. Shown only when **Show stars** is on. |

Counts are reused for the number of minutes set in **Cache duration**, so opening the dashboard again doesn't fetch everything again. Select **Refresh**, or run **Download Tracker: Refresh counts**, to fetch new counts at any time.

Messages above the tiles tell you when something couldn't be loaded. The most common one is GitHub's rate limit. When that happens, the affected plugins show Obsidian's stats file count, which may be a few days old.

Other repositories are counted by every file attached to their GitHub releases, so their numbers mean something different from Obsidian downloads and are not in the plugins and themes total. A repository that doesn't exist or is private shows n/a with a message.

To add a column with each repository's GitHub stars, turn on **Show stars** in settings. This adds one GitHub request per plugin and theme to each refresh, so a token helps if you have many. Stars are not saved in snapshots.

To see the downloads of each released version, turn on **Show downloads by version** in settings. The versions are listed under each plugin, newest first. Themes have no per-version counts.

## Save a snapshot

Select **Save snapshot** on the dashboard, or run **Download Tracker: Save snapshot**. The counts on screen are saved with the time they were fetched.

After that, the Change column compares the counts with that snapshot. If a count now comes from a different source than in the snapshot, for example because GitHub's rate limit forced the stats file, the change shows n/a. Saving the same counts twice is refused, so refresh first if you want a new snapshot.

Snapshots are stored in the plugin's `data.json`. Nothing is saved automatically.

## Export history

Run **Download Tracker: Export snapshot history to note**. The plugin writes a table with one row per snapshot, one column per plugin, theme or repository, and a total for plugins and themes, to the note set in **Export note** (`Download history.md` by default). It creates the folder if needed.

The note is replaced on every export, so keep your own notes about downloads elsewhere.

## Share the current counts

- **Download Tracker: Copy summary to clipboard** copies a plain-text list with the total.
- **Download Tracker: Insert summary table** inserts a Markdown table, with the change since your last snapshot, at the cursor in the current note.
