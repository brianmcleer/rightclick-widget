export interface FeatureLayerConfig {
    name: string;
    url: string;
    fields: string[];
    // Enhanced data source integration
    dataSourceId?: string;           // Experience Builder data source ID
    layerId?: string;               // Specific layer ID within the data source
    useDataSource?: boolean;        // Whether to use data source or manual URL
    displayFields?: string[];       // Specific fields to display (vs query fields)
    aliasFields?: Record<string, string>; // Field name aliases for display
}

// ─── Custom actions (the context menu engine) ───────────────────────────
// A custom action is a menu row the app author adds in settings. It can show
// on every right click, or only when a feature from a matching map layer is
// under the pointer (the widget queries matching layers at the click point
// when the menu opens). What the row does is picked by `type`:
//   url     opens a link built from `template`
//   copy    copies text built from `template` to the clipboard
//   widget  opens another widget in the app (same container handling as the
//           Property Report row) and hands it the point and the feature
//           through MutableStoreManager (key `storeKey`, default
//           'actionPoint') and a window event 'rightclick-action'
//   select  selects the feature in its Experience Builder data source, so
//           Table, List, Chart and any other widget using that data source
//           follow along
//
// Template tokens, replaced at run time (url type URL-encodes each value):
//   {lat} {lon}            WGS84 latitude / longitude
//   {x} {y} {wkid}         map coordinates and spatial reference
//   {address}              reverse-geocoded address when configured
//   {scale} {zoom}         current view scale / zoom level
//   {layer} {layerUrl}     the matched layer's title / URL (feature scope)
//   {objectid}             the matched feature's object id (feature scope)
//   {FIELDNAME}            any attribute of the matched feature, case-insensitive
export type CustomActionType = 'url' | 'copy' | 'widget' | 'select';
export type CustomActionScope = 'always' | 'feature';
export type CustomActionGroup = 'nav' | 'coords' | 'graphics' | 'external' | 'tools' | 'info' | 'custom';

export interface CustomActionConfig {
    id: string;                      // stable id for React keys and the menu action name
    enabled?: boolean;               // undefined means on
    label: string;                   // menu row text; feature rows may use {layer}, {objectid} and {FIELDNAME} tokens
    icon?: string;                   // Calcite icon name, default 'launch'
    // Where the row sits in the menu: inside one of the built-in groups
    // (after that group's last row) or in its own group at the end.
    group?: CustomActionGroup;       // default 'custom'
    scope?: CustomActionScope;       // 'always' (default) or 'feature'
    // Feature scope: which layers count. Case-insensitive substring matches
    // against the live layer's title path ("Group / Service / Layer", so a
    // parent's title covers every layer under it) and/or its URL; both must
    // match when both are set. Both blank = any layer that is on in the map,
    // so the row follows whatever the user right clicks on.
    matchTitle?: string;
    matchUrl?: string;
    hintField?: string;              // attribute shown under the label (feature scope), default: layer title
    type: CustomActionType;
    template?: string;               // url and copy types
    openIn?: 'newTab' | 'sameTab';   // url type, default newTab
    // widget type
    targetWidgetId?: string;
    parentContainerType?: 'controller' | 'accordion' | 'controller+accordion' | 'none';
    parentControllerId?: string;
    accordionWidgetId?: string;
    storeKey?: string;               // MutableStoreManager key, default 'actionPoint'
}

export const defaultCustomAction = (): CustomActionConfig => ({
    id: `ca-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    enabled: true,
    label: '',
    icon: 'launch',
    group: 'custom',
    scope: 'always',
    matchTitle: '',
    matchUrl: '',
    hintField: '',
    type: 'url',
    template: '',
    openIn: 'newTab',
    targetWidgetId: '',
    parentContainerType: 'none',
    parentControllerId: '',
    accordionWidgetId: '',
    storeKey: 'actionPoint'
});

/** A layer matches an action when every non-empty match string is a substring
 *  of the layer's title path / URL; with no match strings every layer matches. Shared by widget.tsx (menu rows) and setting.tsx
 *  (preview of which layers an action would match). */
export const customActionMatchesLayer = (a: CustomActionConfig, layerTitle: string, layerUrl: string): boolean => {
    const mt = (a.matchTitle || '').trim().toLowerCase();
    const mu = (a.matchUrl || '').trim().toLowerCase();
    if (!mt && !mu) return true; // no filter: any layer that is on
    if (mt && (layerTitle || '').toLowerCase().indexOf(mt) < 0) return false;
    if (mu && (layerUrl || '').toLowerCase().indexOf(mu) < 0) return false;
    return true;
};

export interface IMConfig {
    // false turns anonymous usage and error telemetry (src/shared/beacon.ts) off for this app.
    telemetry?: boolean;
  /** Show the question-mark button that opens the help guide. Undefined means on,
   *  so apps configured before this setting existed keep their help button. */
  showHelp?: boolean
    // Custom actions: app-author rows added to the menu. See CustomActionConfig.
    customActions?: CustomActionConfig[];
    useMapWidgetIds: string[];
    coordinateSystem?: 'map' | 'webMercator';
    enabledActions?: {
        zoomIn?: boolean;
        zoomOut?: boolean;
        centerHere?: boolean;
        copyCoordinates?: boolean;
        plotCoordinates?: boolean;      // NEW: Plot coordinate markers
        plotMarker?: boolean;           // NEW: Plot simple markers
        addText?: boolean;              // NEW: Add text functionality
        streetView?: boolean;
        googleMaps?: boolean;           // Open the location in Google Maps
        pictometry?: boolean;
        measureDistance?: boolean;
        measureArea?: boolean;
        whatsHere?: boolean;
        propertyReport?: boolean;
        mailingLabels?: boolean;
    };
    // Context menu presentation options.
    //   showAddress:          true. Reverse-geocode the right-click point and
    //                         show the address in the menu header (requires
    //                         reverseGeocodeUrl). Click the address to copy it.
    //   showHotkeys:          true. Show 1-9 number badges on menu items and
    //                         let those keys trigger the item.
    //   showCoordinateFormats: true. Add a "More coordinate formats" entry
    //                         that expands to Lat/Lon, DMS, map native, UTM,
    //                         custom WKID (if configured), and GeoJSON, each
    //                         copied on click.
    menuSettings?: {
        showAddress?: boolean;
        showHotkeys?: boolean;
        showCoordinateFormats?: boolean;
    };
    propertyReportSettings?: {
        targetWidgetId?: string;
        parentControllerId?: string;
        // Type of the parent container the target widget lives inside.
        // 'controller'           — opens the target via widget-controller
        //                          open/close flow.
        // 'accordion'            — finds the accordion section that owns the
        //                          target widget in the DOM and clicks its
        //                          header so the section expands.
        // 'controller+accordion' — accordion is itself inside a widget
        //                          controller. Open the controller panel
        //                          for the accordion first, then expand
        //                          the accordion section that owns the
        //                          target widget. accordionWidgetId
        //                          identifies the accordion; parentControllerId
        //                          identifies the controller.
        // 'none'                 — target is a top-level widget (e.g. directly
        //                          in a sidebar or fixed pane); just open it.
        parentContainerType?: 'controller' | 'accordion' | 'controller+accordion' | 'none';
        // Used only when parentContainerType === 'controller+accordion':
        // the accordion widget that holds the target. parentControllerId is
        // the widget controller above it.
        accordionWidgetId?: string;
        menuLabel?: string;
    };
    mailingLabelsSettings?: {
        targetWidgetId?: string;
        parentControllerId?: string;
        parentContainerType?: 'controller' | 'accordion' | 'controller+accordion' | 'none';
        accordionWidgetId?: string;
        menuLabel?: string;
    };
    measurementSettings?: {
        defaultUnits: 'feet' | 'meters' | 'miles' | 'kilometers' | 'yards';
        unitDisplay: 'single' | 'both';
    };
    // Long-press behavior for touch devices (phones, tablets). On touch
    // input the user presses and holds on the map to open the same context
    // menu that right-click opens on desktop. Defaults match the iOS and
    // Android native long-press feel:
    //   enabled:         true. Set false to disable mobile long-press entirely.
    //   durationMs:      500. Press-and-hold time before the menu opens.
    //   moveThresholdPx: 10. If the finger drifts farther than this in screen
    //                    pixels before the timer fires, treat the gesture as
    //                    a pan and cancel.
    longPressSettings?: {
        enabled?: boolean;
        durationMs?: number;
        moveThresholdPx?: number;
    };
    reverseGeocodeUrl?: string;
    reverseGeocodeWkid?: number;
    pictometryUrl?: string;
    featureLayers?: FeatureLayerConfig[];

    // Enhanced configuration options
    whatsHereSettings?: {
        maxResults?: number;            // Max features per layer
        searchRadius?: number;          // Search radius in map units
        includeGeometry?: boolean;      // Whether to include geometry in queries
        spatialRelationship?: 'intersects' | 'contains' | 'within';
        orderBy?: string;              // Field to order results by
    };

    // UI customization
    uiSettings?: {
        popupWidth?: number;
        popupMaxHeight?: number;
        showLayerNames?: boolean;       // Whether to show layer names in popup
        groupByLayer?: boolean;         // Group results by layer
        showFieldAliases?: boolean;     // Use field aliases instead of field names
    };

    // UPDATED: Enhanced plot coordinates settings
    plotSettings?: {
        markerSize?: number;           // Size of coordinate markers
        markerColor?: string;          // Color of coordinate markers
        markerStyle?: string;          // NEW: Style of coordinate markers (circle, square, etc.)
        markerOutlineColor?: string;   // NEW: Outline color of coordinate markers
        markerOutlineWidth?: number;   // NEW: Outline width of coordinate markers
        markerAngle?: number;          // NEW: Rotation angle of coordinate markers
        markerXOffset?: number;        // NEW: Horizontal offset of coordinate markers
        markerYOffset?: number;        // NEW: Vertical offset of coordinate markers
        markerOpacity?: number;        // NEW: Opacity of coordinate markers
        textColor?: string;            // Color of coordinate text
        textSize?: number;             // Size of coordinate text
        showCoordinateText?: boolean;  // Whether to show coordinates in popup
        showCoordinateLabels?: boolean; // Whether to show coordinate labels on map
        coordinateSystem?: 'map' | 'webMercator' | 'custom'; // Coordinate system for display
        customWkid?: number;           // Custom WKID for coordinate display
        coordinateFormat?: 'decimal' | 'dms';  // Format for lat/lon display
        decimalPlaces?: number;        // Number of decimal places
        labelOffset?: number;          // Offset distance for coordinate labels
        labelTextSize?: number;        // Size of coordinate label text
        labelTextColor?: string;       // Color of coordinate label text
    };

    // UPDATED: Enhanced marker settings for simple markers
    markerSettings?: {
        markerSize?: number;           // Size of simple markers
        markerColor?: string;          // Color of simple markers
        markerStyle?: string;          // NEW: Style of simple markers (circle, square, etc.)
        markerOutlineColor?: string;   // NEW: Outline color of simple markers
        markerOutlineWidth?: number;   // NEW: Outline width of simple markers
        markerOpacity?: number;        // NEW: Opacity of simple markers
        markerAngle?: number;          // NEW: Rotation angle of simple markers
        markerXOffset?: number;        // NEW: Horizontal offset of simple markers
        markerYOffset?: number;        // NEW: Vertical offset of simple markers
        customPath?: string;           // NEW: Custom SVG path for advanced markers
    };

    // NEW: Text settings configuration
    textSettings?: {
        fontSize?: number;             // Size of text
        fontColor?: string;            // Color of text
        fontFamily?: string;           // Font family
        fontWeight?: 'normal' | 'bold'; // Font weight
        haloColor?: string;            // Text outline color
        haloSize?: number;             // Text outline size
        backgroundColor?: string;       // Optional background color
        backgroundOpacity?: number;     // Background opacity (0-1)
    };

    // NEW: Copy coordinates settings
    copySettings?: {
        coordinateSystem?: 'map' | 'webMercator' | 'custom'; // Coordinate system for copy
        customWkid?: number;           // Custom WKID for coordinate copy
        coordinateFormat?: 'decimal' | 'dms';  // Format for lat/lon display
        decimalPlaces?: number;        // Number of decimal places
        // Coordinate systems the builder imported from a .prj file (or pasted
        // as WKT). Each one adds a copy row to the context menu. This is how a
        // local system with no WKID (a county or project grid) gets on the menu.
        importedSystems?: ImportedCoordinateSystem[];
    };

    // NEW: Per-layer popup display overrides driven by Arcade. Matched at
    // runtime against the live layer's URL and/or title; when matched, the
    // override's HTML content (with {field} and {expression/<name>} placeholders)
    // is rendered in the detail view instead of the default attribute list.
    popupOverrides?: PopupOverrideConfig[];

    // NEW: Developer-controlled list of which map layers participate in
    // "What's Here". Default (undefined or mode === 'all') = every queryable,
    // visible, in-scale layer in the map. mode === 'selected' = only layers
    // whose key appears in selectedKeys. Keys come from computeLayerSelectionKey.
    whatsHereLayerSelection?: WhatsHereLayerSelection;

    // NEW: Symbol used to highlight a feature on the map when the user
    // opens its detail view in the What's Here popup. Default is a 2px
    // Esri-blue outline with no fill.
    whatsHereHighlight?: WhatsHereHighlightConfig;
}

// NEW: Persisted developer choice of which map layers feed What's Here.
export interface WhatsHereLayerSelection {
    // 'all' (default): every layer that is switched on and drawn is searched.
    // 'excluded' (2.4.0): the same, except layers under a key in excludedKeys.
    //   Layers added later are searched, so What's Here follows the map.
    // 'selected' (before 2.4.0): only layers under a key in selectedKeys.
    //   Still honored at runtime; the settings panel converts it to 'excluded'.
    mode?: 'all' | 'excluded' | 'selected';
    excludedKeys?: string[];     // layer or group keys (computeLayerSelectionKey) left out when mode === 'excluded'
    selectedKeys?: string[];     // layer keys (from computeLayerSelectionKey) when mode === 'selected'
    // "Trusted" group / map-service keys. Any layer whose ancestor — or, for
    // sublayers, whose owning MapImageLayer / TileLayer — has a key in this
    // list is auto-included at runtime, regardless of whether its own leaf
    // key is in `selectedKeys`. This is the one-time setup that lets new
    // sublayers added to a map service later (or new layers added inside a
    // GroupLayer) appear in "What's Here" without re-saving the config.
    trustedGroupKeys?: string[];
}

// NEW: Style for the on-map highlight drawn over a selected feature while
// its detail view is open. Colors are hex strings (e.g. '#0079c1') for
// easy <input type="color"> compatibility in the settings UI; the runtime
// converts them to Esri's [r,g,b,a] arrays. When `fillEnabled` is false
// the fill is fully transparent — the feature appears as just an outline,
// which is what most mapping applications default to.
export interface WhatsHereHighlightConfig {
    fillEnabled?: boolean;       // false (default) = no fill, outline only
    fillColor?: string;          // hex, used when fillEnabled === true
    outlineColor?: string;       // hex, also used as the stroke for polylines and point markers
    outlineWidth?: number;       // pixels (1–10 in the UI; clamped on apply)
}

// Shared layer-key derivation used in both setting.tsx and widget.tsx so the
// keys written by settings match the keys checked at runtime.
//
// Rules:
//   - Top-level FeatureLayer / GroupLayer / GeoJSONLayer / CSVLayer / etc.:
//       key is the layer's own `id`.
//   - Sublayer of a MapImageLayer / TileLayer (including nested group
//     sublayers within a map service): key is `${owningServiceLayer.id}::sub::${sublayer.id}`.
//
// Sublayer ids are numeric and unique within the owning service, so the
// composite key uniquely identifies the layer no matter how deeply it sits.
export const computeLayerSelectionKey = (lyr: any): string => {
    if (!lyr) return '';

    // Walk up the parent chain to find the topmost non-sublayer ancestor.
    // For a true sublayer of a MapImageLayer, this will be the MapImageLayer
    // itself. For a top-level layer (or a layer in a GroupLayer), this will
    // stop at the layer itself.
    let walker = lyr;
    let owningService: any = null;
    let hops = 0;
    while (walker?.parent && hops < 25) {
        const p = walker.parent;
        const pCls: string = (p?.declaredClass || '') as string;
        const pType: string = (p?.type || '') as string;

        // If parent is a map-service layer (MapImageLayer, TileLayer, etc.),
        // we've found the owning service.
        if (
            pType === 'map-image' ||
            pType === 'tile' ||
            pType === 'imagery-tile' ||
            pCls.indexOf('MapImageLayer') >= 0 ||
            pCls.indexOf('TileLayer') >= 0
        ) {
            owningService = p;
            break;
        }

        // If parent is a GroupLayer or the Map itself, we're a top-level
        // layer (groups don't change the layer's identity for our purposes).
        if (
            pType === 'group' ||
            pCls.indexOf('GroupLayer') >= 0 ||
            pCls.indexOf('Map') >= 0 ||
            pCls.indexOf('Basemap') >= 0
        ) {
            break;
        }

        walker = p;
        hops++;
    }

    if (owningService) {
        return `${owningService.id}::sub::${lyr.id}`;
    }
    return String(lyr.id ?? lyr.uid ?? lyr.title ?? '');
};

// NEW: A single Arcade expression bound to a popup override. Mirrors the
// shape used by Esri's PopupTemplate.expressionInfos so the values feel
// familiar to anyone who has authored Arcade in Map Viewer.
export interface ArcadeExpressionInfo {
    name: string;                // identifier used as {expression/<name>} in the content template
    title?: string;              // human-readable label (informational only — not rendered automatically)
    expression: string;          // Arcade source
    returnType?: 'string' | 'number' | 'date' | 'boolean';
}

// NEW: Override entry. matchUrl / matchTitle are case-insensitive substring
// matches against the live map layer; if both are set, both must match.
// At least one must be non-empty for the override to fire.
export interface PopupOverrideConfig {
    id: string;                  // stable id for React keys
    enabled: boolean;
    matchUrl?: string;           // substring match against layer.url
    matchTitle?: string;         // substring match against layer.title
    title?: string;              // optional title template (overrides the layer-name header)
    content: string;             // HTML body, may include {field} and {expression/<name>} placeholders
    expressionInfos?: ArcadeExpressionInfo[];
}

// Additional interfaces for data source integration
export interface DataSourceConfig {
    id: string;
    label: string;
    type: 'FEATURE_LAYER' | 'MAP_SERVICE';
    url?: string;
    layerId?: number;
    fields?: FieldConfig[];
}

export interface FieldConfig {
    name: string;
    alias: string;
    type: 'esriFieldTypeString' | 'esriFieldTypeInteger' | 'esriFieldTypeDouble' | 'esriFieldTypeDate';
    visible: boolean;
    editable: boolean;
}

// NEW: Interface for simple markers
export interface SimpleMarker {
    id: string;
    point: __esri.Point;
    graphic: __esri.Graphic;
}

// NEW: Interface for coordinate markers
export interface CoordinateMarker {
    id: string;
    number: number;
    point: __esri.Point;
    graphic: __esri.Graphic;
    coordinateText: string;
}

// NEW: Interface for text graphics
export interface TextGraphic {
    id: string;
    point: __esri.Point;
    graphic: __esri.Graphic;
    text: string;
}

// Configuration validation helpers
export const validateFeatureLayerConfig = (config: FeatureLayerConfig): string[] => {
    const errors: string[] = [];

    if (!config.name?.trim()) {
        errors.push('Layer name is required');
    }

    if (config.useDataSource) {
        if (!config.dataSourceId) {
            errors.push('Data source must be selected when using data source mode');
        }
    } else {
        if (!config.url?.trim()) {
            errors.push('Feature service URL is required when using manual mode');
        } else if (!isValidFeatureServiceUrl(config.url)) {
            errors.push('Invalid feature service URL format');
        }
    }

    return errors;
};

export const isValidFeatureServiceUrl = (url: string): boolean => {
    try {
        const urlObj = new URL(url);
        return urlObj.pathname.includes('/FeatureServer/') ||
            urlObj.pathname.includes('/MapServer/');
    } catch {
        return false;
    }
};

// Default configurations
export const defaultFeatureLayerConfig: FeatureLayerConfig = {
    name: '',
    url: '',
    fields: [],
    useDataSource: true,
    displayFields: [],
    aliasFields: {}
};

export const defaultWhatsHereSettings = {
    maxResults: 10,
    searchRadius: 10,
    includeGeometry: false,
    spatialRelationship: 'intersects' as const,
    orderBy: ''
};

export const defaultUISettings = {
    popupWidth: 300,
    popupMaxHeight: 400,
    showLayerNames: true,
    groupByLayer: true,
    showFieldAliases: true
};

// UPDATED: Enhanced default marker settings for simple markers
export const defaultMarkerSettings = {
    markerSize: 8,
    markerColor: '#0078ff',
    markerStyle: 'circle',
    markerOutlineColor: '#ffffff',
    markerOutlineWidth: 1,
    markerOpacity: 1,
    markerAngle: 0,
    markerXOffset: 0,
    markerYOffset: 0,
    customPath: ''
};

// UPDATED: Enhanced default plot settings for coordinate markers
export const defaultPlotSettings = {
    markerSize: 12,
    markerColor: '#ff6b6b',
    markerStyle: 'circle',
    markerOutlineColor: '#ffffff',
    markerOutlineWidth: 1,
    markerOpacity: 1,
    markerAngle: 0,
    markerXOffset: 0,
    markerYOffset: 0,
    textColor: '#ffffff',
    textSize: 10,
    showCoordinateText: true,
    showCoordinateLabels: true,
    coordinateSystem: 'map' as const,
    customWkid: undefined,
    coordinateFormat: 'decimal' as const,
    decimalPlaces: 6,
    labelOffset: 20,
    labelTextSize: 10,
    labelTextColor: '#000000'
};

// NEW: Default text settings
export const defaultTextSettings = {
    fontSize: 14,
    fontColor: '#000000',
    fontFamily: 'Arial',
    fontWeight: 'bold' as const,
    haloColor: '#ffffff',
    haloSize: 2,
    backgroundColor: 'transparent',
    backgroundOpacity: 0.8
};

// A coordinate system imported from a .prj file or pasted as WKT.
export interface ImportedCoordinateSystem {
    id: string;                    // Stable id, used as the menu action key
    label: string;                 // Row label in the menu (defaults to the WKT name)
    wkt: string;                   // The well-known text, exactly as imported
    decimalPlaces?: number;        // Default 2
    axisOrder?: 'en' | 'ne';       // 'en' = Easting, Northing (X, Y); 'ne' = Northing, Easting (Y, X)
    showInMainMenu?: boolean;      // true = its own row; false or unset (default) = under "More coordinate formats"
}

export interface WktInfo {
    valid: boolean;
    /** 'empty' | 'notWkt' | 'unbalanced' when not valid */
    reason?: 'empty' | 'notWkt' | 'unbalanced';
    name: string;                  // Name of the outer coordinate system
    unit: string;                  // Name of the last UNIT/LENGTHUNIT/ANGLEUNIT in the text
    projected: boolean;            // PROJCS / PROJCRS
    wkt2: boolean;                 // ISO 19162 keywords (PROJCRS, GEOGCRS, ...)
}

const WKT1_ROOTS = ['PROJCS', 'GEOGCS', 'COMPD_CS', 'VERT_CS', 'GEOCCS', 'LOCAL_CS'];
const WKT2_ROOTS = ['PROJCRS', 'PROJECTEDCRS', 'GEOGCRS', 'GEOGRAPHICCRS', 'GEODCRS', 'GEODETICCRS', 'BOUNDCRS', 'COMPOUNDCRS', 'ENGCRS', 'ENGINEERINGCRS'];

// Strip a byte-order mark and collapse the whitespace a .prj file may carry.
export const normalizeWkt = (raw: string): string =>
    String(raw == null ? '' : raw).replace(/^\uFEFF/, '').replace(/[\r\n\t]+/g, ' ').trim();

// Light structural check of a WKT string. Pure text work, no Maps SDK, so the
// settings panel can call it (nothing under src/setting may import esri/*).
// It answers "does this look like a coordinate system definition" and pulls
// out the name and unit for display. The Maps SDK does the real parsing at
// runtime, when the widget builds the SpatialReference.
export const parseWktInfo = (raw: string): WktInfo => {
    const wkt = normalizeWkt(raw);
    const out: WktInfo = { valid: false, name: '', unit: '', projected: false, wkt2: false };
    if (!wkt) { out.reason = 'empty'; return out; }

    const root = /^([A-Za-z_]+)\s*[\[(]\s*"([^"]*)"/.exec(wkt);
    const keyword = root ? root[1].toUpperCase() : '';
    const isWkt1 = WKT1_ROOTS.indexOf(keyword) !== -1;
    const isWkt2 = WKT2_ROOTS.indexOf(keyword) !== -1;
    if (!root || (!isWkt1 && !isWkt2)) { out.reason = 'notWkt'; return out; }

    // Brackets must balance, ignoring anything inside quoted names.
    let depth = 0;
    let inQuote = false;
    let balanced = true;
    for (let i = 0; i < wkt.length; i++) {
        const c = wkt[i];
        if (c === '"') { inQuote = !inQuote; continue; }
        if (inQuote) continue;
        if (c === '[' || c === '(') depth++;
        else if (c === ']' || c === ')') { depth--; if (depth < 0) { balanced = false; break; } }
    }
    if (!balanced || depth !== 0 || inQuote) { out.reason = 'unbalanced'; return out; }

    out.valid = true;
    out.name = root[2];
    out.wkt2 = isWkt2;
    out.projected = keyword === 'PROJCS' || keyword === 'PROJCRS' || keyword === 'PROJECTEDCRS';
    const unitRe = /(?:LENGTHUNIT|ANGLEUNIT|UNIT)\s*[\[(]\s*"([^"]*)"/gi;
    let m: RegExpExecArray | null;
    while ((m = unitRe.exec(wkt)) !== null) out.unit = m[1];
    return out;
};

// NEW: Default copy settings
export const defaultCopySettings = {
    coordinateSystem: 'map' as const,
    customWkid: undefined,
    coordinateFormat: 'decimal' as const,
    decimalPlaces: 2
};

// NEW: Default highlight style for the on-map "selected feature" overlay.
// Cyan (#00FFFF / rgb(0, 255, 255)) — Esri's standard selection-symbol
// colour. Outline only by default, matching the convention most ArcGIS
// applications use to distinguish a selected feature from a hovered one.
export const defaultWhatsHereHighlight: WhatsHereHighlightConfig = {
    fillEnabled: false,
    fillColor: '#00FFFF',
    outlineColor: '#00FFFF',
    outlineWidth: 2
};