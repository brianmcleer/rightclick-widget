# Changelog

Newest first. `manifest.json` and `package.json` are bumped together.

## 2.3.0 (2026-11-23)

- Changed: **Measure Distance** and **Measure Area** now run on the Maps SDK `arcgis-distance-measurement-2d` and `arcgis-area-measurement-2d` components instead of the `DistanceMeasurement2D` and `AreaMeasurement2D` widget classes. Reason: Esri deprecated the widgets in the ArcGIS Maps SDK for JavaScript at version 5.0 and plans to remove them as early as Q1 2027, so anything built on them stops working on an Experience Builder release that ships without them. See [Deprecation: Widgets in ArcGIS Maps SDK for JavaScript](https://support.esri.com/en-us/knowledge-base/deprecation-widgets-in-arcgis-maps-sdk-for-javascript-000040437).
- The measurement panel is the component inside a themed panel with the same Close button. The unit list is limited through the component's `unitOptions` and the "New measurement" button is hidden through `hideStartButton`, so the code that removed those from the widget's markup is gone (`hideUnwantedUnits`, `beautifyMeasurePanel`).
- The widget's own segment, total, area and perimeter labels are drawn from the component's analysis geometry. Esri's built-in on-map label is still suppressed; in the components it is part of a CIM symbol, so the label suppressor now takes the text out of that symbol.

## 2.2.1 (2026-11-19)

### Changed

- Imported coordinate systems now sit under "More coordinate formats" by
  default, with the other alternate formats, instead of taking a row in the
  main menu. The per-system switch "Show as its own row in the menu" is off
  for new imports and unset means off. A system saved with the switch on
  keeps its own row until the switch is turned off. If "More coordinate
  formats" is turned off for the app, imported rows still show in the main
  menu so they stay reachable.

## 2.2.0 (2026-11-19)

### Changed

- **Add Text and Mailing Labels dialogs** are now jimu-ui `Modal`s
  (`src/runtime/components/Dialogs.tsx`) with `TextInput`, `NumericInput`,
  `Select`, `Checkbox` and `Button`, in place of hand-built overlays with
  fixed colors. They follow the app theme and dark mode, keep focus inside,
  and close on Escape or the header X. Add Text is disabled until something
  is typed. The Mailing Labels dialog title uses the configured menu label.
- **What's Here popup** reads the app theme. Its stylesheet, the inline
  fallback and the popup HTML take their colors from `rcPalette`, which the
  widget fills from the theme tokens on every render; about 85 fixed colors
  are gone. Every string in the popup is now a translation key, including
  the summary line, Back and Zoom to, the empty and error states, and the
  fallback names for common system fields.
- **Measurement panels** use the theme surface, border and shadow, and the
  Close button is a Calcite button (plain themed button if Calcite's element
  is not registered). Close, the perimeter label and the area unit
  abbreviations are translated.
- The What's Here popup title and the coordinate marker popup title no
  longer start with an emoji.
- The clipboard fallback prompt and the buffer distance error are
  translated.

### Added

- `tests/`: 40 tests on the Node test runner, no dependencies (they use the
  TypeScript in the Experience Builder client). They cover WKT recognition,
  the pure helpers in `config.ts`, the help guide (content, gating both
  ways, writing rules) and source rules (every used translation key exists,
  no dashes or emoji in strings, no Maps SDK import in settings, no dynamic
  import, no undeclared dependency, no hard-coded UI colors, versions
  agree). Run with `node --test "tests/*.test.cjs"` from the widget folder.
- `docs/`: `handover/` (README, CODE_STRUCTURE, STORAGE, MAINTENANCE,
  TROUBLESHOOTING), `EXPORT_FORMAT.md` for the XML configuration export and
  `PORTING_1.21.md`.
- `telemetry` is now a typed key in `IMConfig`.

### Fixed

- Help guide: with every action turned off, "The menu, button by button"
  showed as an empty section. It is now dropped. The troubleshooting line
  for a missing custom row gave a cause but nothing to do. Both were found
  by the new tests.

### Notes

- New strings are English in the other 39 locales until the next
  `exb-i18n sync`.

## 2.1.0 (2026-11-19)

### Added

- **Imported coordinate systems**: Copy Coordinates Settings has a new
  "Imported coordinate systems" block. The app author imports a `.prj` file
  (or pastes WKT) and the menu gains a row that copies the clicked location
  in that system. This is for systems with no WKID, such as a county grid or
  a low distortion projection. Each system has a menu label (defaults to the
  name in the file), decimal places, coordinate order (Easting, Northing or
  Northing, Easting) and a switch for its own row versus a row under "More
  coordinate formats". WKT 1 and WKT 2 are accepted. The settings panel
  checks the text for structure only (no `esri/*` import under
  `src/setting`); the widget builds the `SpatialReference` from the WKT at
  runtime, caches it, and projects with `projectOperator`. A system whose
  projection fails for a point simply has no row. Round-trips through the
  XML export. Telemetry records `copy-coordinates` with detail `imported`.
- Config: `copySettings.importedSystems` (`ImportedCoordinateSystem`), plus
  `parseWktInfo` and `normalizeWkt` in `config.ts`. Existing apps are
  unchanged until a system is imported.
- Help guide: the imported rows are listed in the menu section, explained
  under "Coordinates and the address", and have a troubleshooting line.

### Changed

- Error messages that used a bare `alert()` now also write to the screen
  reader live region (`notify`).
- README: requirements and install steps now say Experience Builder 1.21 and
  pnpm, matching the manifest.

### Fixed

- Measure Distance and Measure Area failed silently when their modules did
  not load. The user now gets a message and the error reaches telemetry.
- Help guide: the "press and hold" sentence in Start here showed even when
  long press was turned off; the address wording and the default measurement
  unit were hard-coded English and are now translatable strings.
- Settings: removed em dashes from five option and hint strings.
- `src/vendor-shims.d.ts`: removed the classic-JSX global namespace left over
  from before the widget moved to `react-jsx`.

### Notes

- New strings are English in the other 39 locales until the next
  `exb-i18n sync`.

## 2.0.0 (2026-10-15)

### Added

- **Custom actions**: the menu is now an engine the app author extends from
  settings, not a fixed list. A new "Custom Actions" section adds rows that
  show on every right click, or only when the user right clicks on a feature
  from a layer named by title or URL (nested group layers and map service
  sublayers at any depth). Each row does one of four things: open a link,
  copy text, open another widget in the app, or select the feature in its
  Experience Builder data source so Table, List and Chart widgets follow.
  Link and copy rows use templates with `{lat}` `{lon}` `{x}` `{y}` `{wkid}`
  `{address}` `{scale}` `{zoom}` and, for feature rows, `{layer}`
  `{layerUrl}` `{objectid}` and any `{FIELDNAME}`. Widget rows reuse the
  Property Report container handling (controller, accordion, nested) and
  hand the target the point, address and matched feature through
  `MutableStoreManager` (key `actionPoint` by default) plus a
  `rightclick-action` window event, so any widget can be a target without
  changes on its side. Feature rows show a hint under the label (a chosen
  field or the layer name) and sit at the end of the menu so arriving after
  the query never renumbers the rows above. Rows are reorderable in settings
  and round-trip through the XML export. Telemetry records `custom` with the
  action type. The help guide describes configured rows and explains why a
  feature row may be missing. Each row picks its menu group (Navigation,
  Coordinates, Graphics, External links, Measure tools, Information, or an
  own group at the end) and lands after that group's last row. A feature
  row with no layer named follows whatever feature is under the click from
  any layer that is on, one row per layer found (points, then lines, then
  polygons, topmost first), and its label can carry `{layer}`, `{objectid}` or
  `{FIELDNAME}` (for example "Search the web for {layer}").
- Config: `customActions` in `config.ts` (`CustomActionConfig`,
  `customActionMatchesLayer`, `defaultCustomAction`). Existing apps are
  unchanged until a row is added.

### Notes

- New settings and runtime strings are English in the other 39 locales until
  the next `exb-i18n sync`.

## 1.3.4 (2026-09-18)

- Settings: a **Show help guide** option. Turn it off and the question-mark button and the first-run hint both disappear; the guide itself is untouched. Undefined means on, so apps configured before this release keep their help button.

## 1.3.3 (2026-09-18)

- Security: the beacon's session id now falls back to `crypto.getRandomValues` and then to a clock value instead of `Math.random`, which CodeQL flags as insecure randomness (shared beacon 1.1.1). The id only groups one page load's events; it is never a secret or a credential.
- Build: `tsconfig.json` is `jsx: react-jsx` with `jsxImportSource: @emotion/react`, matching the Experience Builder client. ts-loader reads the widget tsconfig, and the previous classic `jsx: react` setting made the settings panel and runtime fail with "Cannot convert undefined or null to object" after a full rebuild. No functional change.

## 1.3.2 (2026-09-18)

- Added: anonymous usage and error telemetry (shared beacon module; off unless the portal publishes an exb-beacon-sink table; telemetry: false in config disables it).

## 1.3.1 (2026-09-17)

- Packaging: the Visual Studio editor shims are no longer in the release zip. `publish.ps1` strips them from a staging copy (`$ReleaseOnlyExclude`) and refuses to zip if any ambient `declare module` of react, jimu or esri survives. The shims stay in the GitHub repo; clone users delete them before building.

## 1.3.0

### Added

- In-widget help guide (handoff Section 10). A Help button (Calcite `question`
  icon) sits at the right end of the "Location" header row of the context
  menu, on the same line as the label. It closes the menu and opens the shared
  `HelpPopup` (copied unchanged from the pattern) with a searchable accordion.
  `?` or `F1` while the menu is open does the same. Sections are built in
  `src/runtime/helpSections.ts` from feature flags computed with the same
  checks `getMenuItems()` uses, so the guide only describes rows the menu
  shows. Strings live in `src/runtime/translations/default.ts` with the
  shared `help*` keys. No first-run hint: the widget has no resting view, the
  menu is its only UI.

## 1.2.0

### Changed

- Context menu placement. The menu is now rendered in a portal on
  `document.body` and positioned by a layout effect that measures its real
  size after render, then flips it left of the pointer when it would run off
  the right edge and above the pointer when it would run off the bottom, and
  clamps the remainder inside the viewport with an 8 px margin. Its height is
  capped to the viewport and scrolls inside. The previous code guessed a fixed
  200 x 450 size, which let the menu run off the page on right clicks near the
  bottom or right of the map.
- Context menu appearance. Colors, radii and shadows now come from the
  Experience's theme through `src/runtime/theme.ts` (`useTokens()`), so the
  menu follows the app's theme and dark mode. Emoji row icons replaced with
  Calcite icons (`CalciteIcon`) so rows look the same on every OS and browser.
- The menu closes on window resize and page scroll, since its anchor is no
  longer valid after either.

### Fixed

- Visual Studio Error List. The widget now uses the GIS Division's
  self-contained editor setup (mode B): `tsconfig.json` with no `paths`,
  `"types": []`, classic `"jsx": "react"`, plus `src/exb-editor-shims.d.ts`
  (unchanged copy of `widgets\_vs`) and a widget-specific
  `src/vendor-shims.d.ts` (global JSX namespace, `MutableStoreManager`,
  namespace-imported `esri/*` modules, `calcite-components`). The three
  `// @ts-nocheck` lines are gone, so the sources are now really type checked.
  `npx tsc -p .` reports 0 errors.
- `setting.tsx` imported `AllWidgetSettingProps` from `jimu-for-builder`,
  which the editor shim declares as a shorthand module (TS2709). Replaced with
  a local structural `SettingProps` type; the builder passes the same object.
- `jsxFactory: "jsx"` in the old tsconfig broke `setting.tsx`, which has no
  `/** @jsx jsx */` pragma and compiles through `React.createElement`
  (TS2874, TS17016). The factory is now set per file by the pragma only.

## 1.1.0

- Prior release.
