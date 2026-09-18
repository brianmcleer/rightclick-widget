# Changelog

Newest first. `manifest.json` and `package.json` are bumped together.

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
