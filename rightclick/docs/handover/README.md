# Right Click widget: handover

Where to start if you are picking this widget up. Written for the GIS Division and for
anyone who forks the public repository.

## What it is

An ArcGIS Experience Builder widget (Developer Edition 1.21) that adds a right-click
context menu to a map. It has no visible panel of its own: the menu, two small dialogs,
the What's Here popup and the measurement panels are all overlays on the map.

## Read these, in this order

1. `../../README.md`: what the widget does, install steps, settings overview.
2. `CODE_STRUCTURE.md`: file by file, and a "where is X" table for `widget.tsx`.
3. `MAINTENANCE.md`: the routine jobs (add a menu row, a setting, a string, a help line).
4. `TROUBLESHOOTING.md`: symptom, cause, fix.
5. `STORAGE.md`: what is saved and where (short: only the app config).
6. `../EXPORT_FORMAT.md`: the XML configuration export.
7. `../PORTING_1.21.md`: what changed moving to Experience Builder 1.21 / Maps SDK 5.x.
8. `../../CHANGELOG.md`: every release.

## Build and run

The widget builds with the Experience Builder client; it has no build of its own and no
third-party dependencies.

1. The folder sits at `client\your-extensions\widgets\rightclick` with `manifest.json`
   directly inside it.
2. From `client`: `pnpm install` once (Experience Builder 1.21 and later), then `npm start`.
3. Open the builder, add the widget to an experience, connect it to a map widget.

## Check before every release

Run both from the widget folder (`client\your-extensions\widgets\rightclick`), in
PowerShell or Command Prompt, no elevation needed:

```
npx tsc -p .
node --test "tests/*.test.cjs"
```

Both must be clean. `tsc` is the Visual Studio type check (editor shims, `noEmit`);
webpack in `npm start` remains the build authority. The tests need no install: they use
the TypeScript that ships in the client. See `MAINTENANCE.md` for what they cover.

Then smoke test in the browser. The tests do not exercise the Maps SDK or React:

- Right click at all four corners of the map; the menu stays on screen.
- Copy Coordinates, an imported coordinate system row, and one "More coordinate formats" row.
- Add Text and Mailing Labels dialogs open, take keyboard focus, close on Escape.
- Measure Distance and Measure Area open their panel; Close removes it.
- What's here? lists features, opens a detail view, Back and Zoom to work.
- Help opens from the menu header and from `?`.
- Repeat the first two in a dark theme.

## Release

`publish.ps1` in the repository root mirrors this folder into the repository, commits,
pushes and (with `-Release vX.Y.Z`) cuts a release zip. The Experience Builder folder is
the single source of truth: edit here, never in the repository copy. Bump `manifest.json`
and `package.json` together and add a `CHANGELOG.md` entry first; a test fails if the
three disagree.

## Conventions this widget follows

The GIS Division widget playbook (`WIDGETHANDOFF.md`) sets these; the short version:

- jimu-ui and Calcite components for UI; no hand-built buttons, inputs or dialogs.
- No hard-coded colors. React UI reads `useTokens()` from `src/runtime/theme.ts`; HTML
  built outside React reads `rcPalette`, which the widget fills from the same tokens.
- Every user-facing string is a key in `translations/default.ts`.
- Nothing under `src/setting` imports `esri/*`.
- No dynamic `import()`. Maps SDK modules that are loaded late go through
  `loadArcGISJSAPIModules`.
- A config switch that turns a feature off removes it everywhere: menu, help guide, runtime.
