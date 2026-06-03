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

export interface IMConfig {
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
        pictometry?: boolean;
        measureDistance?: boolean;
        measureArea?: boolean;
        whatsHere?: boolean;
        propertyReport?: boolean;
        mailingLabels?: boolean;
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
    mode?: 'all' | 'selected';   // 'all' (default) = every layer; 'selected' = only those listed
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