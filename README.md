# Right Click Widget

A custom widget for ArcGIS Experience Builder that adds a configurable
right-click context menu to map widgets. Right-click anywhere on the map
to get zoom, copy coordinates, plot markers, measure, What's Here, and
options to launch companion widgets like Property Report and Mailing
Labels at the clicked location.

By Brian McLeer, GIS Administrator/Developer, City of Grand Junction, CO.

## Links

- Esri Community blog post (downloads, changelog, discussion):
  https://community.esri.com/t5/experience-builder-custom-widgets/right-click-widget/bc-p/1625489
- Releases (downloadable widget zip):
  https://github.com/brianmcleer/rightclick-widget/releases
- Issues: https://github.com/brianmcleer/rightclick-widget/issues

## Quick install

Download `rightclick.zip` from the latest release, extract, and drop the
`rightclick/` folder into `client/your-extensions/widgets/` in your
Experience Builder install. From `client/`, run `npm install` and `npm
start`. The widget then appears in the Custom section of the builder.

Full install steps and configuration tips are in the widget's own
[README](rightclick/README.md).

## Compatibility

Built and tested on ArcGIS Experience Builder Developer Edition **1.19
and 1.20** (React 19). Earlier EB versions (1.18 and below) are not
supported.

## Repository layout

```
rightclick-widget/
├── README.md             this file (GitHub landing page)
├── LICENSE               Apache 2.0
├── .gitignore            ignores node_modules, .vs, etc.
├── publish.ps1           one-command sync/commit/publish script
└── rightclick/           the actual widget
    ├── manifest.json
    ├── config.json
    ├── icon.svg
    ├── package.json
    ├── package-lock.json
    ├── README.md
    ├── LICENSE
    ├── .gitignore
    ├── .npmignore
    └── src/
```

The `rightclick/` subfolder is the only thing downstream users need. The
release zip is built from that folder.

## Publishing updates (maintainers only)

This repo uses a single PowerShell script that syncs the widget from the
local Experience Builder folder, commits, pushes, and optionally cuts a
release.

### One-time setup

- Install GitHub CLI: `winget install --id GitHub.cli`, then reopen the
  terminal.
- Authenticate: `gh auth login` (GitHub.com, HTTPS, "Yes" to authenticate
  Git, log in via web browser).
- Edit the three variables at the top of `publish.ps1` if needed
  (`$WidgetName`, `$RepoName`, `$ExbWidgetPath`). For this repo they're
  already set to `rightclick`, `rightclick-widget`, and the standard
  EB 1.20 path.

### Every later update

From a terminal opened in the repo folder:

```powershell
# Code update only
powershell -ExecutionPolicy Bypass -File .\publish.ps1

# Code update plus a new release
powershell -ExecutionPolicy Bypass -File .\publish.ps1 -Release v1.1.0
```

The script does the following on every run:

1. Mirrors the widget from `client\your-extensions\widgets\rightclick`
   into the `rightclick/` subfolder of this repo, skipping `node_modules`
   and `.vs`.
2. Runs `git init` if the repo isn't initialized yet.
3. Commits any changes.
4. Pushes to GitHub (creating the repo via `gh` on the first run).
5. If `-Release vX.Y.Z` was passed, zips the `rightclick/` folder and
   cuts a GitHub Release with the zip attached.

### Version tag rules

Tags must increase and never repeat (GitHub rejects duplicates).
- Bug fix: `v1.0.1`, `v1.0.2`
- New feature: `v1.1.0`, `v1.2.0`
- Major change: `v2.0.0`

## License

Apache 2.0. See [LICENSE](LICENSE).
