# Storage

The Right Click widget keeps almost nothing. There is no browser database, no portal
item of its own and no saved user data.

| What | Where | Scope | Lifetime |
|---|---|---|---|
| Widget settings, including imported coordinate system definitions (WKT text) and custom actions | The app's config (`config.json` of the experience), written by the builder | The app | Until the app author changes it |
| Markers, coordinate labels and text added from the menu | Graphics on the map view, held in component state | The browser tab | Until removed with Undo or Clear, or the page reloads |
| Mailing Labels buffer choice (on or off, distance, unit) | Component state | The browser tab | Until the page reloads |
| Point handed to another widget (Property Report, Mailing Labels, custom widget rows) | `MutableStoreManager`, key `actionPoint` unless a custom action names another; plus a `rightclick-action` window event | The page | Replaced on the next launch |
| Usage and error counts | Posted by `src/shared/beacon.ts` to the portal's `exb-beacon-sink` table, when one exists | The organization | Managed outside this widget |

Notes:

- Nothing is written to `localStorage`, `sessionStorage` or IndexedDB by this widget.
- The XML export (`../EXPORT_FORMAT.md`) is a copy of the app config that the app author
  downloads; the widget does not keep it.
- The beacon never records coordinates, addresses, attribute values or user names. See
  "Usage telemetry" in the widget README.
