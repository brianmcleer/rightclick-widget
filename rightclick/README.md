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

### Settings

- Toggle each action on or off
- Configure coordinate systems, marker styles, text formatting, popups,
  measurement units, reverse geocoding service, and Pictometry URL
- Configure What's Here layer selection with a tri-state tree, trust
  toggles for groups, and Arcade-based popup overrides
- Import and export the full configuration as XML for backup or
  transferring between applications

## Requirements

- ArcGIS Experience Builder Developer Edition **1.19 or 1.20** (React 19).
  EB 1.18 and earlier are not supported.

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

3. From the `client` folder, run:

   ```
   npm install
   npm start
   ```

   Experience Builder will auto-install any widget dependencies on the
   first `npm install`. After `npm start` compiles, the widget appears in
   the Custom section of the widget picker in the builder.

4. Drop the widget into an experience, open its settings, pick the map
   widget(s) it should listen to, and turn on the actions you want.

## Placement in the experience

The widget runs in the background and doesn't render any visible UI on
the page (the context menu and dialogs are overlays). Recommended:

- Size: small (e.g. 1×1)
- Place it in an unused corner of the layout
- Use "Send to back" so it doesn't intercept clicks
- Keep it visible (not in a hidden state)
- Desktop layouts only — the right-click model doesn't fit
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
  option "Widget Controller → Accordion (nested)" — that gives you a
  second dropdown for the inner Accordion's widget id, and the widget
  will open the controller's panel, then expand the right accordion
  section automatically.

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
