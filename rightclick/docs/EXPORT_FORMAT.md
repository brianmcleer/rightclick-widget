# Configuration export format (XML)

The settings panel can export the widget's whole configuration to XML and import it
again, for backup or to move a setup between apps. This is the format. It is produced and
read by `serializeConfigToXml` and `parseXmlToConfig` in `src/setting/setting.tsx`.

## Shape

- One root element, `<RightClickConfig>`. An import with any other root is refused.
- Every child element is a config key from `IMConfig` (`src/config.ts`); nesting follows
  the config object.
- There is no version attribute. The file mirrors the config as it is; keys the widget
  does not know are kept as plain data and ignored at runtime, and missing keys fall back
  to their defaults. That is what makes an export from an older version importable.

## How values are written

| Value | XML |
|---|---|
| String | Element text, escaped. Text with a line break, `<` or `&` is wrapped in `CDATA` so Arcade and HTML templates read exactly as typed. |
| Empty string | Self-closing element. |
| Number | `type="number"` attribute, number as text. |
| Boolean | `type="boolean"` attribute, `true` or `false`. |
| Array | `type="array"` attribute, one `<item>` child per entry. An empty array is a self-closing element with `type="array"`. |
| Object | Child elements, one per key. An empty object is a self-closing element. |
| `null` | Self-closing element with `null="true"`. |
| `undefined` | Not written. |

An element with no `type` attribute is read as an object when it has child elements and as
a string when it has none.

## Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<RightClickConfig>
  <useMapWidgetIds type="array">
    <item>widget_3</item>
  </useMapWidgetIds>
  <enabledActions>
    <zoomIn type="boolean">true</zoomIn>
    <copyCoordinates type="boolean">true</copyCoordinates>
  </enabledActions>
  <copySettings>
    <coordinateSystem>map</coordinateSystem>
    <decimalPlaces type="number">2</decimalPlaces>
    <importedSystems type="array">
      <item>
        <id>crs_abc123_x1</id>
        <label>Mesa County LCS</label>
        <wkt>PROJCS["MCLCSGVA",GEOGCS["GCS_WGS_1984",...],UNIT["Foot",0.3048]]</wkt>
        <decimalPlaces type="number">2</decimalPlaces>
        <axisOrder>ne</axisOrder>
        <showInMainMenu type="boolean">true</showInMainMenu>
      </item>
    </importedSystems>
  </copySettings>
</RightClickConfig>
```

## Things to know

- Widget ids (`useMapWidgetIds`, target widget ids for Property Report, Mailing Labels and
  custom actions) belong to the app they were exported from. After importing into another
  app, pick the map and the target widgets again.
- Config keys are written as element names. A key with a character that is not legal in an
  XML name has that character replaced with `_`, so such a key would not round-trip. No
  key in `IMConfig` is affected.
- The export holds everything in the config, including service URLs. Treat it like the
  app's own configuration when sharing it.
