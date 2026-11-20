# Right Click Widget

A custom widget for ArcGIS Experience Builder that adds a configurable
right-click context menu to map widgets. When a user right-clicks on the
map, a menu appears offering a set of actions the developer has enabled in
the settings panel: zoom, copy coordinates, plot markers, measure, What's
Here, and (optionally) launching companion widgets like Property Report
and Mailing Labels with the clicked location.

## Features

### Map actions

- **Menu header**: shows the clicked location's address (reverse geocoded,
  click to copy) and coordinates at the top of every menu. Items are grouped
  with separators and carry 1-9 number hotkeys for keyboard use
- **Navigation**: Zoom In, Zoom Out, Center Here
- **Coordinates**: Copy Coordinates in the configured system, plus a "More
  coordinate formats" entry that expands to Lat/Lon decimal, DMS, UTM (zone
  detected automatically), the configured custom projection, map native X/Y,
  and a GeoJSON point, each copied on click. Plot Coordinates (numbered
  markers with optional labels), Plot Marker (simple markers)
- **Imported coordinate systems**: import a `.prj` file (or paste WKT) in
  settings to add a coordinate system that has no WKID, such as a county or
  project grid. Each one adds a row under "More coordinate formats" that copies the clicked location in
  that system, with its own label, decimal places and coordinate order
  (Easting, Northing or Northing, Easting)
- **Graphics**: Add Text (custom font, color, halo, optional background),
  Undo Last Graphic, Clear All Graphics
- **External services**: Open in Google Street View, Open in Google Maps,
  Open in Pictometry
- **Measurement**: Measure Distance, Measure Area, with filtered unit options
  and single or dual unit display
- **What's Here**: reverse geocoding plus feature-layer queries against
  any layers in the live map, with drill-down into MapImageLayer sublayers
  and group layers. Trusted groups auto-include any nested layers (current
  and future) without needing the settings to be re-saved
- **Launch companion widgets**: Property Report and Mailing Labels can be
  opened at the right-click point. Supports three container layouts: a
  plain Widget Controller, a plain Accordion, or an Accordion nested
  inside a Widget Controller
- **Custom actions**: add your own rows in settings. A row shows on every
  right click, or only when the user right clicks on a feature from a layer
  you name (by title or URL; nested group layers and map service sublayers
  at any depth). Each row opens a link, copies text, opens another widget
  in the app, or selects the feature in its data source so Table, List and
  Chart widgets on that data source follow. Link and copy rows use templates
  with `{lat}` `{lon}` `{x}` `{y}` `{wkid}` `{address}` `{scale}` `{zoom}`
  and, for feature rows, `{layer}` `{layerUrl}` `{objectid}` and any
  `{FIELDNAME}`. Widget rows hand the target the point, address and matched
  feature through `MutableStoreManager` (key `actionPoint` by default) and
  a `rightclick-action` window event

### Settings

- Toggle each action on or off
- Add, reorder and remove custom actions (link, copy, widget, select)
- Configure coordinate systems, marker styles, text formatting, popups,
  measurement units, reverse geocoding service, and Pictometry URL
- Import coordinate systems from `.prj` files under Copy Coordinates
  Settings (see "Imported coordinate systems" below)
- Configure What's Here layer selection with a tri-state tree, trust
  toggles for groups, and Arcade-based popup overrides
- Import and export the full configuration as XML for backup or
  transferring between applications

## Requirements

- ArcGIS Experience Builder Developer Edition **1.21** (built and tested
  there; `exbVersion` in the manifest is 1.21.0). EB 1.18 and earlier
  (React 18) are not supported.

## Install

1. Download the widget zip from the
   [Releases](https://github.com/brianmcleer/rightclick-widget/releases)
   page (or the Esri Community attachment).
2. Extract it into your Experience Builder install. The widget folder must
   sit directly inside `your-extensions/widgets/`:

   ```
   client/your-extensions/widgets/rightclick/
       manifest.json
       config.json
       icon.svg
       package.json
       src/
   ```

   **Do not nest** the widget a second level deep (e.g.
   `widgets/rightclick/rightclick/`). The `manifest.json` must be the
   direct child of the widget folder, or Experience Builder won't register
   it. See the troubleshooting note below.

3. From the `client` folder, install and start. Experience Builder 1.21
   and later use pnpm:

   ```
   pnpm install
   npm start
   ```

   On Experience Builder 1.20 and earlier, use `npm install` in place of
   `pnpm install`. This widget has no third-party dependencies, so the
   install step adds nothing for it. After `npm start` compiles, the widget
   appears in the Custom section of the widget picker in the builder.

4. Drop the widget into an experience, open its settings, pick the map
   widget(s) it should listen to, and turn on the actions you want.

### The release zip and the editor shims

The zip is the widget only. The Visual Studio type shims in the repo (`rightclick/src/exb-editor-shims.d.ts`, `rightclick/src/vendor-shims.d.ts`) are left out on purpose: their ambient `declare module` blocks are not file-scoped and would rewrite the react, jimu and esri types for every other widget in your `your-extensions` folder.

If you clone the repository instead of using the zip, delete `rightclick/src/exb-editor-shims.d.ts` and the other shim files listed above before building; nothing else depends on them.

## Placement in the experience

The widget runs in the background and doesn't render any visible UI on
the page (the context menu and dialogs are overlays). Recommended:

- Size: small (e.g. 1×1)
- Place it in an unused corner of the layout
- Use "Send to back" so it doesn't intercept clicks
- Keep it visible (not in a hidden state)
- Desktop layouts only - the right-click model doesn't fit
  tablet or phone viewers

## Configuration tips

- **What's Here trusted groups**: in the layer-selection tree, click the
  "Trust" pill next to a group or map service. Trusted groups
  auto-include every nested layer, including ones added to the service
  later, so you don't have to re-tick boxes and re-save the config every
  time a new sublayer is added.
- **Property Report / Mailing Labels container layout**: if the target
  widget lives inside a Widget Controller, set Container Type to "Widget
  Controller". If it lives inside an Accordion, set it to "Accordion".
  If the Accordion is itself inside a Widget Controller, use the third
  option "Widget Controller → Accordion (nested)" - that gives you a
  second dropdown for the inner Accordion's widget id, and the widget
  will open the controller's panel, then expand the right accordion
  section automatically.

### Custom action examples

- Parcel lookup in the county assessor site, only on parcels: Show this row =
  only on a matching feature, Match layer title = `Parcels`, What it does =
  Open a link, Link =
  `https://assessor.example.org/parcel/{PARCELNUM}`, Hint field = `PARCELNUM`.
- Copy a Google Maps link for any spot: Show this row = on every right click,
  What it does = Copy text, Text =
  `https://www.google.com/maps/search/?api=1&query={lat},{lon}`.
- Send a street segment to a custom widget: Show this row = only on a
  matching feature, Match layer URL = `/Transportation/MapServer/3`, What it
  does = Open a widget, pick the widget and its container. The widget reads
  `MutableStoreManager` key `actionPoint` (or your own Store key); the
  payload is `{ point, latLon, address, feature: { attributes, geometry,
  layerTitle, layerUrl, objectId }, actionId, actionLabel, timestamp }`.
  A `rightclick-action` window event carries the same payload with
  `targetWidgetId`.
- Search the web for whatever was clicked: Show this row = only on a
  matching feature, leave both match fields blank, Menu Label =
  `Search the web for {layer}`, What it does = Open a link, Link =
  `https://www.google.com/search?q={layer}+{objectid}`. The row follows
  any layer that is on in the map.
- Select a hydrant in the Table widget: Show this row = only on a matching
  feature, Match layer title = `Hydrants`, What it does = Select the feature.
  Works for layers the connected map widget exposes as data sources.

## Imported coordinate systems

Some coordinate systems have no WKID: county grids, low distortion
projections, project grids. To put one on the menu:

1. In the widget settings, open **Copy Coordinates Settings** and find
   **Imported coordinate systems**.
2. Click **Import .prj file** and choose the file, or click **Paste WKT
   instead** and paste the text. Esri and OGC WKT 1 (`PROJCS[...]`,
   `GEOGCS[...]`) and WKT 2 (`PROJCRS[...]`) are accepted.
3. Set the menu label, decimal places and coordinate order. The row sits
   under "More coordinate formats"; turn on **Show as its own row in the
   menu** to put it in the main menu instead.

Right click, open "More coordinate formats", and the row shows the
coordinates under its label; click it to copy. The definition is saved in the app config and is included in the XML
export.

Two things to know:

- **Datum.** The definition is used exactly as written. If its datum differs
  from the map's (for example a WGS 1984 definition on a NAD 1983 map), the
  Maps SDK applies its default datum transformation for the area, which can
  move the result by about a meter. If your organization treats the two datums
  as the same, edit the `GEOGCS` part of the `.prj` to match the map's datum
  before importing, and no shift is applied.
- **Checking it.** Right click a point whose coordinates you already know in
  that system and compare. A system's origin is the easiest: it should read
  the false easting and false northing from the file.

## For developers

- `docs/handover/README.md` is the starting point: code map, routine
  maintenance, troubleshooting, the XML export format and the 1.21 porting
  notes.
- Checks, run from the widget folder inside an Experience Builder client:
  `npx tsc -p .` (type check) and `node --test "tests/*.test.cjs"` (tests).
  The tests need no install; they use the TypeScript that ships in the
  client.

## Usage telemetry

This widget records anonymous usage counts and errors so the GIS Division can see which widgets and versions are in use and which errors users hit. It records the app id and title, widget name and version, the action name, a truncated error message, the site host name and browser family. It never records usernames, coordinates, addresses, attribute values or URLs with query strings. Where the data goes: on page load the widget asks the app's portal for a public item tagged `exb-beacon-sink` and posts to that table. If your portal has no such item, nothing is sent anywhere. To turn it off for an app, set `"telemetry": false` in the widget's config, or users can enable Do Not Track in their browser. The shared module is `src/shared/beacon.ts`.

## Troubleshooting

### `<name> is duplicated` when running `npm start`

Experience Builder registers each widget by the `name` field in its
`manifest.json` and throws this error when two registered widgets have
the same name. A single, correctly placed copy can't duplicate itself, so
a second copy is somewhere in the install. Check in this order:

1. Nested folder: `widgets/rightclick/rightclick/`. The `manifest.json`
   must be the direct child of the widget folder, not one level deeper.
   This is the most common cause when a zip is extracted into a folder
   that already has the widget's name.
2. A leftover folder from an earlier build, including any `-copy` folder
   or one under the widget's previous name if it was renamed.
3. A stale compiled build in `client/dist/widgets/rightclick/`. Stop the
   client server, delete that folder, then start again.

If removing one copy makes the widget disappear entirely from the
Entrypoint list at startup, the copy that remained was nested too deep.
Move it so `manifest.json` is directly inside the widget folder.

## Feedback

Bug reports and feature requests are best filed on the
[Esri Community blog post](https://community.esri.com/t5/experience-builder-custom-widgets/right-click-widget/bc-p/1625489)
or as a GitHub issue.

## License

Apache 2.0. See [LICENSE](LICENSE).

## Localization verification

The October 2026 i18n pass connects local UI helpers, messages and metadata to the app locale and uses the app locale for date/number formatting. Existing units, currencies and configured format options are preserved. Translation files use Esri wording, shared memory and English fallbacks; machine translations still need language review. Catalog coverage is separate from UI coverage. Changes were checked with the widget’s Experience Builder webpack build and compared against its existing TypeScript diagnostics. Test runtime, settings, accessibility text and locale switching in your target languages.
