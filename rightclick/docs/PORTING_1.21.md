# Porting notes: Experience Builder 1.21 / Maps SDK 5.x

What changed when this widget moved from Experience Builder 1.20 (Maps SDK 4.x) to 1.21
(Maps SDK 5.x). Kept as a record for the next version move; the release-by-release detail
is in `CHANGELOG.md` (1.2.0 through 1.3.4).

## Build and tooling

- **pnpm.** The 1.21 client installs with pnpm; `npm install` errors by design. The widget
  has no third-party dependencies, so only the install command in the README changed.
- **Widget tsconfig is read by the build.** ts-loader reads `tsconfig.json` in the widget
  folder. It must be `jsx: "react-jsx"` with `jsxImportSource: "@emotion/react"`, matching
  the client. A classic `jsx: "react"` setting compiled, then failed at runtime with
  "Cannot convert undefined or null to object" (fixed in 1.3.3).
- **Visual Studio.** On a pnpm install VS cannot read `client\node_modules`, so the widget
  carries a self-contained tsconfig (no `paths`, `"types": []`) and ambient shims in
  `src/exb-editor-shims.d.ts` and `src/vendor-shims.d.ts`. The shims are editor only and
  are left out of the release zip, because ambient declarations leak into every other
  widget in `your-extensions` (1.3.1).

## Maps SDK

- **Projection.** `esri/geometry/projection` became `esri/geometry/operators/projectOperator`.
  The widget loads it once (`ensureProjectOperator`) and calls `projectOperator.execute`.
- **Module imports.** Modules used on every right click are static ESM imports. Rarely used
  ones (measurement widgets, Arcade, length and area math) load late through
  `loadArcGISJSAPIModules`. There is no dynamic `import()`.
- **Popup content lives in a shadow root.** A stylesheet in `document.head` no longer
  reaches the What's Here popup. The content now carries its own `<style>` element
  (`rcWhContentCss`), and `applyRcWhInlineStyles` applies the same look as inline styles in
  case the embedded style is stripped. DOM walks that climb out of the popup cross the
  shadow boundary with `rcParentAcrossShadow`.
- **Measurement panels lost Esri's styling.** Class names changed and the panel rendered
  as run-together text. `beautifyMeasurePanel` restores the stacked layout by matching the
  panel's content, with no dependency on Esri class names.
- **`__esri` types.** The members the widget names are declared as open interfaces in a
  `declare global` block at the top of `widget.tsx`, so they merge with the real types when
  those are present and stand alone when they are not.

## Measurement (moved to components in 2.3.0)

- The `DistanceMeasurement2D` and `AreaMeasurement2D` widget classes were deprecated in
  Maps SDK 5.0. Since 2.3.0 the measure rows use the `arcgis-distance-measurement-2d` and
  `arcgis-area-measurement-2d` components, registered through `import
  'arcgis-map-components'`, which Experience Builder externalizes. Nothing in the widget
  depends on `esri/widgets/*` any more.
