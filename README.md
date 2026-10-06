# Download Tracker

An Obsidian plugin that shows the download counts of the community plugins and themes published from your GitHub accounts, and saves dated snapshots so you can see how the counts change.

## What it does

- Lists every plugin and theme in Obsidian's community directory whose repository belongs to one of your GitHub usernames, plus any extra repositories you name.
- Shows each item's download count, the change since your last snapshot and where the count came from, with subtotals and a total.
- Optionally lists the downloads of each released version of a plugin.
- Optionally shows the number of GitHub stars on each repository.
- Optionally shows the date of each project's first and latest published GitHub release.
- Counts the release downloads of other GitHub repositories you name, in a separate table.
- Optionally lists every repository you own, public and private, and tags each one with its visibility.
- Optionally shows the number of open issues and open pull requests in each repository.
- Links each name to its repository on GitHub. This can be turned off.
- Saves snapshots of the counts in the plugin's data and writes the snapshot history to a note as a Markdown table.
- Draws charts on a separate tab: downloads by project, downloads over time, change since the last snapshot, downloads by version, and other repositories. The charts are plain HTML and SVG drawn by the plugin; no other plugin or chart library is needed.
- Copies a plain-text summary to the clipboard, or inserts a summary table into the current note.

It shows nothing else about your repositories beyond the optional columns described below. Stars are shown as they are now; snapshots record downloads only.

## Install

Until the plugin is in the community directory:

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Create the folder `.obsidian/plugins/download-tracker` in your vault and put the three files in it.
3. In Obsidian, open **Settings → Community plugins**, reload the list and turn on **Download Tracker**.

The plugin needs Obsidian 1.11.4 or later, because it keeps the GitHub token in Obsidian's secret storage. It is built for desktop and mobile.

## Use

Set your GitHub username under **Settings → Download Tracker**, then open the dashboard from the ribbon icon or the **Download Tracker: Open dashboard** command. The [user guide](USER_GUIDE.md) covers each task.

## How counts are calculated

- **Plugins.** The plugin sums the downloads of the `manifest.json` file attached to each GitHub release of the plugin. Obsidian downloads that file once for every install and every update, and builds its own count the same way, so this matches the number in Obsidian's plugin browser but is current. These counts are labelled "GitHub live".
- **Fallback.** If GitHub refuses a request because of the rate limit or a rejected token, the plugin uses Obsidian's stats file instead and says so on the dashboard. Obsidian updates the stats file on its own schedule, and it can be days behind. These counts are labelled "Obsidian stats file".
- **Themes.** Theme counts come from Obsidian's theme statistics. If they cannot be loaded, themes show "n/a" and the rest of the refresh still completes.
- **All repositories and visibility.** With this setting on, every repository owned by your GitHub usernames is listed, except forks, and every row is tagged Public or Private. Plugins and themes in Obsidian's directory are always public. Private repositories appear only when the GitHub token belongs to that account and can read them, for example a fine-grained token with read-only Contents access.
- **Open issues.** GitHub's own open-issue number includes pull requests, so the plugin lists the open issues and leaves pull requests out. A repository with nothing open costs no extra request. Open pull requests come from GitHub's pull request list. A repository with issues or pull requests turned off shows n/a for that column. For private repositories, the token needs read-only Issues or Pull requests access.
- **Release dates.** The initial release is the date of the earliest published GitHub release and the last updated date is that of the latest one. Drafts and pre-releases are ignored, because Obsidian doesn't install them. When GitHub can't be reached, a plugin's last updated date comes from Obsidian's stats file. Dates are shown in your local time zone, in the format set under **Date format**, or in your Obsidian language's format if that is empty. Exported history and summaries always use `YYYY-MM-DD HH:mm`.
- **Other repositories.** An extra repository that isn't in Obsidian's community lists is shown under "Other repositories". Its count is the sum of the downloads of every file attached to its GitHub releases, labelled "GitHub release files". One person downloading three files counts three times, GitHub doesn't count its automatic source-code archives, and installs through package managers aren't included. These counts are kept out of the plugins and themes total.

Limits:

- A download is an install or an update, not a person. Updating a plugin, or installing it in a second vault, counts again.
- A plugin or theme appears only once it is in Obsidian's community lists. Projects still in review are not shown.
- The change column compares with the most recent snapshot saved before the counts were fetched. If the count's source differs from the snapshot's, for example a live count saved and a stats-file count now, the change shows n/a.
- Without a token, GitHub allows 60 requests an hour from your network. Each plugin and other repository takes at least one request per refresh, showing stars adds one request per repository, showing either release date adds one request per theme, listing all repositories adds one request per page of 100 repositories plus at least one per repository, and open issues and open pull requests each add one request per repository that has anything open.

## Network use

The plugin connects to these hosts only when you open the dashboard, run a command that needs counts, or turn on refresh at startup:

- `raw.githubusercontent.com`: Obsidian's community plugin list, theme list and plugin stats file, from the `obsidianmd/obsidian-releases` repository.
- `api.github.com`: the release list of each of your plugins and other repositories, to read download counts and release dates, and, if you turn on stars, each repository's star count. If you set a token, it is sent only to this host.
- `releases.obsidian.md`: Obsidian's theme download statistics.

## Privacy

The plugin has no telemetry, analytics or accounts, and sends nothing about you or your vault anywhere. The requests above read public data, and your private repositories only if your token allows it. Apart from repository names, the only thing they carry is your GitHub token, if you set one, and only to `api.github.com`.

Settings, the last fetched counts and the snapshot history are stored in the plugin's `data.json` in your vault. The GitHub token is stored in Obsidian's secret storage, not in `data.json`. A token with no scopes is enough, because the plugin only reads public data. To include private repositories, use a fine-grained token with read-only Contents access; it can read those repositories' code if it leaks, but it can't change anything.

## Development

```bash
npm install
npm test
npm run build
```

`npm run dev` rebuilds on every change. To copy each build into a vault, put the path of the vault's `.obsidian/plugins/download-tracker` folder in a file named `.dev-plugin-dir` at the repository root. Git ignores that file.

Pushing a version tag starts the release workflow. It builds twice to check the output is identical, attests `main.js`, `manifest.json` and `styles.css`, and creates a draft release.

## Credits

Created by Anthony Fitzpatrick at Wolf 359 Press. Released under the MIT licence.
