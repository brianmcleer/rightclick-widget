/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
/** @jsx jsx */
import { React, jsx, css, AllWidgetProps, ReactRedux, MutableStoreManager, getAppStore, appActions } from 'jimu-core';
import { JimuMapViewComponent, JimuMapView } from 'jimu-arcgis';

// Hoisted Esri module imports (JS API 5.x ESM pattern). Modules used on every
// right-click or routinely throughout the widget are imported statically here
// so they're tree-shaken into the bundle and don't pay the AMD-require cost on
// each invocation. Heavy / rarely-used modules (DistanceMeasurement2D,
// AreaMeasurement2D, geometryEngine) are still loaded lazily via window.require
// at their call sites so they don't bloat the initial widget bundle.
import Point from 'esri/geometry/Point';
import SpatialReference from 'esri/geometry/SpatialReference';
import * as projectOperator from 'esri/geometry/operators/projectOperator';
import * as geometryJsonUtils from 'esri/geometry/support/jsonUtils';
import * as locator from 'esri/rest/locator';
import Graphic from 'esri/Graphic';
import TextSymbol from 'esri/symbols/TextSymbol';
import SimpleMarkerSymbol from 'esri/symbols/SimpleMarkerSymbol';

import { IMConfig, FeatureLayerConfig, CoordinateMarker, SimpleMarker, TextGraphic, PopupOverrideConfig, ArcadeExpressionInfo, WhatsHereLayerSelection, WhatsHereHighlightConfig, computeLayerSelectionKey } from '../config';

// Ambient declarations for the `__esri` global namespace. Esri's TypeScript
// definitions normally expose this globally via @types/arcgis-js-api, but
// some Experience Builder build configurations don't have that on the
// type-resolution path. Declaring the few members we reference as `any`
// here is enough to satisfy the type checker without changing runtime
// behaviour. All values that come through these types are real Esri
// objects at runtime; we just lose IDE autocomplete inside this file.
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace __esri {
        type MapView = any;
        type SceneView = any;
        type Point = any;
        type Geometry = any;
        type Polyline = any;
        type Polygon = any;
        type Multipoint = any;
        type Extent = any;
        type Graphic = any;
        type GraphicsLayer = any;
        type WatchHandle = any;
        type DistanceMeasurement2D = any;
        type AreaMeasurement2D = any;
        type Measurement = any;
        type Popup = any;
        type PopupTemplate = any;
        type Symbol = any;
        type SimpleMarkerSymbol = any;
        type SimpleLineSymbol = any;
        type SimpleFillSymbol = any;
        type TextSymbol = any;
        type FeatureLayer = any;
        type MapImageLayer = any;
        type GroupLayer = any;
        type Sublayer = any;
        type Layer = any;
        type Field = any;
    }
}

// Module-level cache for projectOperator.load(). The operator is a process
// singleton — once loaded, isLoaded() returns true forever. We still cache the
// in-flight promise so concurrent right-clicks don't trigger duplicate loads,
// and we null it on rejection so a transient CSP/WASM failure (common in local
// dev) doesn't permanently disable projection for the session.
let _projectOperatorReady: Promise<void> | null = null;
const ensureProjectOperator = (): Promise<void> => {
    if (projectOperator.isLoaded && projectOperator.isLoaded()) return Promise.resolve();
    if (!_projectOperatorReady) {
        _projectOperatorReady = projectOperator.load().catch((err: unknown) => {
            _projectOperatorReady = null; // allow retry on next call
            throw err;
        });
    }
    return _projectOperatorReady;
};

// Lazy-load the Arcade module. Arcade is only needed when a popup override
// with expressionInfos fires, so it doesn't belong in the initial widget
// bundle. Cached at module scope so concurrent calls share one load.
let _arcadeModulePromise: Promise<any> | null = null;
const loadArcadeModule = (): Promise<any> => {
    if (!_arcadeModulePromise) {
        _arcadeModulePromise = new Promise((resolve, reject) => {
            try {
                (window as any).require(['esri/arcade'], resolve, reject);
            } catch (e) {
                reject(e);
            }
        }).catch((err) => {
            _arcadeModulePromise = null; // allow retry next click
            throw err;
        });
    }
    return _arcadeModulePromise;
};

interface State {
    contextMenu: {
        visible: boolean;
        x: number;
        y: number;
        mapPoint?: __esri.Point;
        coordinateLabel?: string;
        projectedLatLon?: { lat: number; lon: number };
    };
    showingContextMenu: boolean;
    isMeasuring: boolean;
    measurementWidget: __esri.DistanceMeasurement2D | null;
    isMeasuringArea: boolean;
    areaMeasurementWidget: __esri.Measurement | null;
    layerFieldMetadata: { [layerUrl: string]: { [fieldName: string]: { alias: string; type: string } } };
    // Coordinate plotting state
    coordinateMarkers: CoordinateMarker[];
    nextMarkerNumber: number;
    plotModeActive: boolean;
    // Simple marker state
    simpleMarkers: SimpleMarker[];
    // Text graphics state
    textGraphics: TextGraphic[];
    showTextDialog: boolean;
    pendingTextLocation: __esri.Point | null;
    // Mailing Labels buffer-choice dialog state.
    // mailingLabelsBufferEnabled drives a checkbox inside the dialog — when on,
    // the user provides a distance and unit; when off, no buffer is applied.
    showMailingLabelsBufferDialog: boolean;
    pendingMailingLabelsLocation: __esri.Point | null;
    mailingLabelsBufferEnabled: boolean;
    mailingLabelsBufferDistance: string;
    mailingLabelsBufferUnit: 'feet' | 'meters' | 'kilometers' | 'miles';
    mailingLabelsBufferError: string;
    // Accessibility state
    announceMessage: string;
    focusedMenuIndex: number;
}

// Enhanced unit and button cleanup function with MutationObserver for instant "New Measurement" suppression.
// Returns a disconnect function to stop the observer when the measurement widget is destroyed.
const hideUnwantedUnits = (widget: any, widgetType: 'distance' | 'area' = 'distance'): (() => void) => {
    const unwantedUnits = {
        distance: [
            'imperial', 'metric', 'inches', 'nautical miles', 'nautical-miles',
            'feet (us)', 'feet-us', 'us feet', 'us-feet'
        ],
        area: [
            'imperial', 'metric', 'square inches', 'square-inches',
            'square nautical miles', 'square-nautical-miles',
            'square feet (us)', 'square-feet-us', 'square us feet', 'square-us-feet',
            'ares'
        ]
    };

    const targetUnits = unwantedUnits[widgetType];
    let observer: MutationObserver | null = null;
    let styleEl: HTMLStyleElement | null = null;

    // Inject CSS to instantly hide known "New Measurement" / clear button classes before paint
    const injectHideCSS = () => {
        try {
            styleEl = document.createElement('style');
            styleEl.textContent = `
                .esri-distance-measurement-2d__clear-button,
                .esri-area-measurement-2d__clear-button,
                .esri-direct-line-measurement-3d__clear-button,
                .esri-measurement__clear-button {
                    display: none !important;
                    visibility: hidden !important;
                    height: 0 !important;
                    overflow: hidden !important;
                    pointer-events: none !important;
                }
            `;
            document.head.appendChild(styleEl);
        } catch (e) {
            // Silent fail
        }
    };

    // Remove "New Measurement" buttons and hint elements from a container
    const removeNewMeasurementButtons = (container: Element) => {
        try {
            const buttons = container.querySelectorAll('button, calcite-button');
            buttons.forEach((button: any) => {
                const text = (button.textContent || '').toLowerCase().trim();
                if (text.includes('new measurement') || text === 'new measurement') {
                    button.style.display = 'none';
                    button.style.visibility = 'hidden';
                    button.hidden = true;
                    try { button.remove(); } catch (e) { /* silent */ }
                }
            });

            const hints = container.querySelectorAll(
                '.esri-distance-measurement-2d__hint, .esri-area-measurement-2d__hint, .esri-measurement__hint'
            );
            hints.forEach((hint: any) => {
                hint.style.display = 'none';
                try { hint.remove(); } catch (e) { /* silent */ }
            });
        } catch (e) {
            // Silent fail
        }
    };

    // Remove unwanted unit options from dropdowns
    const removeUnwantedOptions = (container: Element) => {
        try {
            const selectors = [
                'calcite-select calcite-option',
                'select option',
                '[role="option"]',
                'calcite-option'
            ];

            selectors.forEach(selector => {
                const options = container.querySelectorAll(selector);
                options.forEach((option: any) => {
                    const value = (option.value || '').toLowerCase().trim();
                    const text = (option.textContent || option.innerText || '').toLowerCase().trim();
                    const label = (option.label || '').toLowerCase().trim();

                    const shouldRemove = targetUnits.some(unwantedUnit => {
                        const unwanted = unwantedUnit.toLowerCase();
                        return value === unwanted ||
                            text === unwanted ||
                            label === unwanted ||
                            value.includes(unwanted) ||
                            text.includes(unwanted) ||
                            label.includes(unwanted);
                    });

                    if (shouldRemove) {
                        option.style.display = 'none';
                        option.style.visibility = 'hidden';
                        option.hidden = true;
                        option.disabled = true;
                        try { option.remove(); } catch (e) { /* silent */ }
                    }
                });
            });
        } catch (e) {
            // Silent fail
        }
    };

    // Full cleanup pass on the container
    const fullCleanup = () => {
        try {
            const container = widget.container;
            if (!container) return;
            removeNewMeasurementButtons(container);
            removeUnwantedOptions(container);
        } catch (e) {
            // Silent fail
        }
    };

    // Inject CSS immediately
    injectHideCSS();

    // Run initial cleanup passes
    fullCleanup();
    setTimeout(fullCleanup, 10);
    setTimeout(fullCleanup, 50);
    setTimeout(fullCleanup, 100);

    // Timed cleanup for unit options that may render later
    let attempts = 0;
    const timedCleanup = () => {
        if (attempts++ > 15) return;
        fullCleanup();
        const delays = [50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000];
        if (attempts <= delays.length) {
            setTimeout(timedCleanup, delays[attempts - 1] || 1000);
        }
    };
    timedCleanup();

    // Set up MutationObserver to catch "New Measurement" button the instant it appears in DOM
    try {
        const container = widget.container;
        if (container) {
            observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        removeNewMeasurementButtons(container);
                    }
                }
            });
            observer.observe(container, { childList: true, subtree: true });
        }
    } catch (e) {
        // Silent fail
    }

    // Return a disconnect function to clean up the observer and injected CSS
    return () => {
        try {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
            if (styleEl && styleEl.parentNode) {
                styleEl.parentNode.removeChild(styleEl);
                styleEl = null;
            }
        } catch (e) {
            // Silent fail
        }
    };
};

/**
 * Suppress the ESRI measurement widget's built-in on-map text labels.
 * Each instance is scoped to only the layers added by its specific widget.
 */
const createLabelSuppressor = (mapView: any) => {
    let layerSnapshot: Set<any> = new Set();

    const isTextGraphic = (g: any): boolean => {
        if (!g?.symbol) return false;
        const t = g.symbol.type || '';
        if (t !== 'text' && t !== 'esriTS') return false;
        // Never suppress our own custom labels - only ESRI's built-in measurement labels
        const ownTypes = [
            'segment-label', 'total-label', 'area-label', 'perimeter-label',
            'coordinate-marker', 'coordinate-text', 'coordinate-label',
            'simple-marker', 'text-graphic', 'measurement-graphic'
        ];
        const attrType = g.attributes?.type;
        const isOwn = ownTypes.includes(attrType);
        if (isOwn) return false;
        return true;
    };

    const snapshotLayers = () => {
        try {
            layerSnapshot = new Set(mapView.map?.allLayers?.items || []);
        } catch (e) { /* silent */ }
    };

    const startSuppression = (): (() => void) => {
        let active = true;
        const restorations: Array<() => void> = [];
        const patchedCollections = new WeakSet<any>();

        const patchCollection = (graphics: any) => {
            if (!graphics || patchedCollections.has(graphics)) return;
            patchedCollections.add(graphics);

            const origAdd = graphics.add?.bind(graphics);
            if (origAdd) {
                graphics.add = (item: any, ...a: any[]) => {
                    if (active && isTextGraphic(item)) return;
                    return origAdd(item, ...a);
                };
                restorations.push(() => { graphics.add = origAdd; });
            }
            const origAddMany = graphics.addMany?.bind(graphics);
            if (origAddMany) {
                graphics.addMany = (items: any[], ...a: any[]) => {
                    if (!active) return origAddMany(items, ...a);
                    const f = (items || []).filter((g: any) => !isTextGraphic(g));
                    return f.length ? origAddMany(f, ...a) : undefined;
                };
                restorations.push(() => { graphics.addMany = origAddMany; });
            }
            const origPush = graphics.push?.bind(graphics);
            if (origPush) {
                graphics.push = (...items: any[]) => {
                    if (!active) return origPush(...items);
                    const f = items.filter((g: any) => !isTextGraphic(g));
                    return f.length ? origPush(...f) : graphics.length;
                };
                restorations.push(() => { graphics.push = origPush; });
            }
            const origSplice = graphics.splice?.bind(graphics);
            if (origSplice) {
                graphics.splice = (start: number, del: number, ...items: any[]) => {
                    if (!active) return origSplice(start, del, ...items);
                    const f = items.filter((g: any) => !isTextGraphic(g));
                    return origSplice(start, del, ...f);
                };
                restorations.push(() => { graphics.splice = origSplice; });
            }

            // Scrub any text graphics already present
            try {
                const existing = (graphics.items || []).filter(isTextGraphic);
                if (existing.length > 0) {
                    graphics.removeMany?.(existing) ||
                        existing.forEach((g: any) => graphics.remove?.(g));
                }
            } catch (e) { /* silent */ }
        };

        const patchNewLayers = () => {
            try {
                const all = mapView.map?.allLayers?.items || [];
                for (const layer of all) {
                    if (!layerSnapshot.has(layer) && layer.graphics) {
                        patchCollection(layer.graphics);
                    }
                }
            } catch (e) { /* silent */ }
        };

        let afterAddHandle: any = null;
        try {
            afterAddHandle = mapView.map?.allLayers?.on?.('after-add', (evt: any) => {
                if (active && evt.item && !layerSnapshot.has(evt.item) && evt.item.graphics) {
                    patchCollection(evt.item.graphics);
                }
            });
        } catch (e) { /* silent */ }

        patchNewLayers();
        const timers = [0, 50, 100, 200, 500, 1000, 2000].map(d =>
            setTimeout(patchNewLayers, d)
        );

        return () => {
            active = false;
            afterAddHandle?.remove?.();
            timers.forEach(t => clearTimeout(t));
            restorations.forEach(fn => { try { fn(); } catch (e) { /* silent */ } });
            restorations.length = 0;
        };
    };

    return { snapshotLayers, startSuppression };
};

const Widget = (props: AllWidgetProps<IMConfig>) => {
    // Get theme from Redux store (more reliable than props.theme)
    const storeTheme = ReactRedux.useSelector((state: any) => state?.appStateInBuilder?.theme || state?.appConfig?.theme);

    // Default font stack for Experience Builder
    const DEFAULT_FONT = 'Avenir Next, Avenir, Helvetica Neue, Helvetica, Arial, sans-serif';

    // Get theme font family from Experience Builder theme - try multiple paths
    const getThemeFont = React.useCallback((): string => {
        const theme = (props.theme || storeTheme) as any;

        if (theme) {
            // ExB 1.14+ / theme2 paths (check first for newer versions)
            if (theme.sys?.typography?.body?.fontFamily) return theme.sys.typography.body.fontFamily;
            if (theme.ref?.typeface?.brand) return theme.ref.typeface.brand;

            // ExB 1.x standard paths
            if (theme.typography?.fontFamilyBase) return theme.typography.fontFamilyBase;
            if (theme.body?.fontFamily) return theme.body.fontFamily;
            if (theme.fontFamilyBase) return theme.fontFamilyBase;

            // Shared theme paths
            if (theme.sharedTheme?.body?.fontFamily) return theme.sharedTheme.body.fontFamily;
            if (theme.surfaces?.[0]?.body?.fontFamily) return theme.surfaces[0].body.fontFamily;
            if (theme.header?.fontFamily) return theme.header.fontFamily;
        }

        return DEFAULT_FONT;
    }, [props.theme, storeTheme]);

    const themeFont = getThemeFont() || DEFAULT_FONT;

    const mapWidgetIds = props.config?.useMapWidgetIds || props.useMapWidgetIds;

    const [state, setState] = React.useState<State>({
        contextMenu: { visible: false, x: 0, y: 0 },
        showingContextMenu: false,
        isMeasuring: false,
        measurementWidget: null,
        isMeasuringArea: false,
        areaMeasurementWidget: null,
        layerFieldMetadata: {},
        // Initialize coordinate plotting state
        coordinateMarkers: [],
        nextMarkerNumber: 1,
        plotModeActive: false,
        // Initialize simple marker state
        simpleMarkers: [],
        // Initialize text graphics state
        textGraphics: [],
        showTextDialog: false,
        pendingTextLocation: null,
        // Initialize mailing labels buffer-choice dialog state
        showMailingLabelsBufferDialog: false,
        pendingMailingLabelsLocation: null,
        mailingLabelsBufferEnabled: true,
        mailingLabelsBufferDistance: '100',
        mailingLabelsBufferUnit: 'feet',
        mailingLabelsBufferError: '',
        // Initialize accessibility state
        announceMessage: '',
        focusedMenuIndex: -1
    });

    const mapViewRef = React.useRef<__esri.MapView | null>(null);
    const menuRef = React.useRef<HTMLDivElement | null>(null);
    const dialogRef = React.useRef<HTMLDivElement | null>(null);
    const textInputRef = React.useRef<HTMLInputElement | null>(null);
    const mailingLabelsDialogRef = React.useRef<HTMLDivElement | null>(null);
    const mailingLabelsApplyBufferBtnRef = React.useRef<HTMLInputElement | null>(null);
    const previousActiveElement = React.useRef<HTMLElement | null>(null);
    // Track event handlers to prevent duplicates
    const handlersAttachedRef = React.useRef<boolean>(false);
    const lastMapViewRef = React.useRef<__esri.MapView | null>(null);
    // Holds the current "What's Here" session so master/detail navigation
    // (the click handlers on the popup's clickable rows and the Back button)
    // can re-render without re-running the underlying queries.
    const whatsHereSessionRef = React.useRef<{
        mapPoint: __esri.Point;
        addressText: string;
        results: Array<{ layerName: string; features: any[]; layerUrl: string; popupEnabled: boolean; mapLayer?: any }>;
    } | null>(null);
    // Remembers the user-chosen popup size across master↔detail navigation
    // (and across subsequent right-clicks). Updated by a ResizeObserver on
    // every popup body; applied as an explicit width/height on the next
    // popup body that's built. Null means "use defaults".
    const whatsHerePopupSizeRef = React.useRef<{ width: number | null; height: number | null }>({
        width: null,
        height: null
    });
    // Live highlight graphic drawn over the feature whose detail view is
    // currently open. Set when renderFeature opens; cleared on renderMaster
    // (Back), on next renderFeature (so we don't stack highlights), and when
    // the popup closes entirely.
    const whatsHereHighlightRef = React.useRef<__esri.Graphic | null>(null);
    // WatchHandle for `popup.visible` that fires when the user dismisses the
    // popup (X button, click elsewhere, right-click again). Used to clear
    // the highlight graphic so it doesn't outlive the popup. Reassigned on
    // each new What's Here session.
    const whatsHerePopupCloseHandleRef = React.useRef<{ remove: () => void } | null>(null);
    // True while the master "What's Here" list is the active popup view,
    // false once the user has drilled into a feature detail. Used by the
    // hover-to-highlight handlers on master rows: a mouseleave that fires
    // *after* a click has transitioned us to detail must NOT wipe out the
    // detail-view highlight that renderFeature just set.
    const whatsHereMasterIsActiveRef = React.useRef<boolean>(false);

    // Announce message to screen readers
    const announce = React.useCallback((message: string) => {
        setState(prev => ({ ...prev, announceMessage: '' }));
        setTimeout(() => {
            setState(prev => ({ ...prev, announceMessage: message }));
        }, 50);
    }, []);

    // Prevent browser context menu
    React.useEffect(() => {
        const root = document.querySelector('.widget-right-click-map');
        const handler = (e: MouseEvent) => {
            if (e.target instanceof Node && root?.contains(e.target)) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        };

        document.addEventListener('contextmenu', handler, { capture: true, passive: false });
        return () => {
            document.removeEventListener('contextmenu', handler, { capture: true });
        };
    }, []);

    const hideContextMenu = React.useCallback(() => {
        setState(prevState => ({
            ...prevState,
            showingContextMenu: false,
            contextMenu: { ...prevState.contextMenu, visible: false },
            focusedMenuIndex: -1
        }));
    }, []);

    // Document-level click handler to dismiss context menu
    React.useEffect(() => {
        const handleDocumentClick = (e: MouseEvent) => {
            // If context menu is visible and click is outside the menu, close it
            if (state.contextMenu.visible && menuRef.current) {
                if (!menuRef.current.contains(e.target as Node)) {
                    hideContextMenu();
                }
            }
        };

        // Use mousedown for faster response
        document.addEventListener('mousedown', handleDocumentClick);
        return () => {
            document.removeEventListener('mousedown', handleDocumentClick);
        };
    }, [state.contextMenu.visible, hideContextMenu]);

    // Reset handler tracking on unmount
    React.useEffect(() => {
        return () => {
            handlersAttachedRef.current = false;
            lastMapViewRef.current = null;
        };
    }, []);

    // Load field metadata for all configured layers
    React.useEffect(() => {
        const loadFieldMetadata = async () => {
            if (!props.config?.featureLayers?.length) return;

            const metadata: { [layerUrl: string]: { [fieldName: string]: { alias: string; type: string } } } = {};

            for (const layer of props.config.featureLayers) {
                if (!layer.url) continue;

                try {
                    const response = await fetch(`${layer.url}?f=json`);
                    const layerInfo = await response.json();

                    if (layerInfo.fields) {
                        metadata[layer.url] = {};
                        layerInfo.fields.forEach((field: any) => {
                            metadata[layer.url][field.name] = {
                                alias: field.alias || field.name,
                                type: field.type
                            };
                        });
                    }
                } catch (error) {
                    // console.warn(`Failed to load field metadata for layer: ${layer.url}`, error);
                }
            }

            setState(prev => ({ ...prev, layerFieldMetadata: metadata }));
        };

        loadFieldMetadata();
    }, [props.config?.featureLayers]);

    const copyWithPrompt = React.useCallback((coords: string) => {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = coords;
            textArea.style.cssText = 'position:fixed;left:-999999px;top:-999999px;';
            document.body.appendChild(textArea);
            textArea.select();

            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);

            if (!successful) {
                prompt('Please copy these coordinates manually:', coords);
            }
        } catch {
            prompt('Please copy these coordinates manually:', coords);
        }
    }, []);

    const projectToLatLon = React.useCallback(async (point: __esri.Point): Promise<__esri.Point> => {
        try {
            await ensureProjectOperator();
            const wgs84SR = new SpatialReference({ wkid: 4326 });
            const sourcePoint = new Point({
                x: point.x,
                y: point.y,
                spatialReference: point.spatialReference
            });
            const projected = projectOperator.execute(sourcePoint, wgs84SR) as __esri.Point;
            if (projected?.x !== undefined && projected?.y !== undefined &&
                Math.abs(projected.y) <= 90 && Math.abs(projected.x) <= 180) {
                return projected;
            }
        } catch {
            // Fall through to original point — manualProjectToLatLon will be used
            // by callers as the synchronous fallback.
        }
        return point;
    }, []);

    const projectToSpatialReference = React.useCallback(async (point: __esri.Point, wkid: number): Promise<__esri.Point> => {
        try {
            await ensureProjectOperator();
            const spatialRef = new SpatialReference({ wkid });
            const sourcePoint = new Point({
                x: point.x,
                y: point.y,
                spatialReference: point.spatialReference
            });
            const projected = projectOperator.execute(sourcePoint, spatialRef) as __esri.Point;
            return projected || point;
        } catch {
            return point;
        }
    }, []);

    const manualProjectToLatLon = React.useCallback((point: __esri.Point): { lat: number, lon: number } => {
        try {
            const wkid = point.spatialReference?.wkid;

            // Already geographic
            if (wkid === 4326 || wkid === 4269 || wkid === 4267) {
                return { lat: point.y, lon: point.x };
            }

            // Web Mercator — exact inverse Mercator formula
            if (wkid === 3857 || wkid === 102100 || wkid === 102113) {
                const lon = point.x / 20037508.342 * 180;
                const lat = (2 * Math.atan(Math.exp(point.y / 20037508.342 * Math.PI)) - Math.PI / 2) * 180 / Math.PI;
                return { lat, lon };
            }

            // UTM zones — full Transverse Mercator inverse (geodetically accurate)
            let zone: number | null = null;
            let isSouth = false;
            if (wkid >= 32601 && wkid <= 32660) { zone = wkid - 32600; isSouth = false; }
            else if (wkid >= 32701 && wkid <= 32760) { zone = wkid - 32700; isSouth = true; }
            else if (wkid >= 26901 && wkid <= 26923) { zone = wkid - 26900; isSouth = false; }

            if (zone !== null) {
                const a = 6378137.0;           // WGS84 semi-major axis
                const e2 = 0.00669437999014;    // WGS84 eccentricity squared
                const k0 = 0.9996;              // UTM scale factor
                const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

                const x = point.x - 500000;
                const y = isSouth ? point.y - 10000000 : point.y;

                const M = y / k0;
                const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));

                const phi1 = mu
                    + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
                    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
                    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu)
                    + (1097 * e1 * e1 * e1 * e1 / 512) * Math.sin(8 * mu);

                const sinPhi1 = Math.sin(phi1);
                const cosPhi1 = Math.cos(phi1);
                const tanPhi1 = Math.tan(phi1);

                const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
                const T1 = tanPhi1 * tanPhi1;
                const C1 = (e2 / (1 - e2)) * cosPhi1 * cosPhi1;
                const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
                const D = x / (N1 * k0);
                const D2 = D * D;

                const latRad = phi1
                    - (N1 * tanPhi1 / R1) * (
                        D2 / 2
                        - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * (e2 / (1 - e2))) * D2 * D2 / 24
                        + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * (e2 / (1 - e2)) - 3 * C1 * C1) * D2 * D2 * D2 / 720
                    );

                const lonRad = (
                    D
                    - (1 + 2 * T1 + C1) * D2 * D / 6
                    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * (e2 / (1 - e2)) + 24 * T1 * T1) * D2 * D2 * D / 120
                ) / cosPhi1;

                const centralMeridian = (zone - 1) * 6 - 180 + 3;
                return {
                    lat: Math.max(-90, Math.min(90, latRad * 180 / Math.PI)),
                    lon: Math.max(-180, Math.min(180, centralMeridian + lonRad * 180 / Math.PI))
                };
            }

            // Unknown SR — return raw values
            return { lat: point.y, lon: point.x };
        } catch {
            return { lat: point.y, lon: point.x };
        }
    }, []);

    // Convert decimal degrees to degrees, minutes, seconds
    const convertToDMS = React.useCallback((decimal: number, type: 'lat' | 'lon'): string => {
        const isNegative = decimal < 0;
        const absolute = Math.abs(decimal);
        const degrees = Math.floor(absolute);
        const minutesFloat = (absolute - degrees) * 60;
        const minutes = Math.floor(minutesFloat);
        const seconds = (minutesFloat - minutes) * 60;

        let direction = '';
        if (type === 'lat') {
            direction = isNegative ? 'S' : 'N';
        } else {
            direction = isNegative ? 'W' : 'E';
        }

        return `${degrees}° ${minutes}' ${seconds.toFixed(2)}" ${direction}`;
    }, []);

    const copyCoordinates = React.useCallback(() => {
        const { mapPoint, projectedLatLon } = state.contextMenu;
        if (!mapViewRef.current || !mapPoint) return;

        // Must be fully synchronous — clipboard.writeText and execCommand both
        // require an unbroken user-gesture chain. Any await kills clipboard access.
        // projectedLatLon is pre-computed async on right-click (accurate Transverse
        // Mercator math), so it's ready by the time the user picks this menu item.
        try {
            const copySettings = props.config?.copySettings || {
                coordinateSystem: 'map',
                customWkid: undefined,
                coordinateFormat: 'decimal',
                decimalPlaces: 2
            };

            let coords: string;

            if (copySettings.coordinateSystem === 'webMercator') {
                const { lat, lon } = projectedLatLon ?? manualProjectToLatLon(mapPoint);
                if (copySettings.coordinateFormat === 'dms') {
                    coords = `${convertToDMS(lat, 'lat')}, ${convertToDMS(lon, 'lon')}`;
                } else {
                    coords = `${lat.toFixed(copySettings.decimalPlaces || 6)}, ${lon.toFixed(copySettings.decimalPlaces || 6)}`;
                }
            } else if (copySettings.coordinateSystem === 'custom' && copySettings.customWkid) {
                // Custom SR: use raw map coords as fallback (accurate projection was async)
                coords = `${mapPoint.x.toFixed(copySettings.decimalPlaces || 2)}, ${mapPoint.y.toFixed(copySettings.decimalPlaces || 2)}`;
            } else {
                coords = `${mapPoint.x.toFixed(copySettings.decimalPlaces || 2)}, ${mapPoint.y.toFixed(copySettings.decimalPlaces || 2)}`;
            }

            // Synchronous clipboard write — preserves user gesture
            copyWithPrompt(coords);
            announce(`Coordinates copied: ${coords}`);
        } catch (error) {
            announce(`Error copying coordinates`);
        }
    }, [state.contextMenu, props.config?.copySettings, manualProjectToLatLon, convertToDMS, copyWithPrompt, announce]);

    // Show text input dialog
    const showTextInputDialog = React.useCallback(() => {
        const { mapPoint } = state.contextMenu;
        if (!mapPoint) return;

        // Save current focus for restoration when dialog closes
        previousActiveElement.current = document.activeElement as HTMLElement;

        setState(prev => ({
            ...prev,
            showTextDialog: true,
            pendingTextLocation: mapPoint
        }));
    }, [state.contextMenu]);

    // Add text to map
    const addTextToMap = React.useCallback((text: string) => {
        const mapView = mapViewRef.current;
        const location = state.pendingTextLocation;

        if (!mapView || !location || !text.trim()) {
            setState(prev => ({
                ...prev,
                showTextDialog: false,
                pendingTextLocation: null
            }));
            // Restore focus to previous element
            previousActiveElement.current?.focus();
            return;
        }

        try {
            const configTextSettings = props.config?.textSettings || {};
            const textSettings = {
                fontSize: configTextSettings.fontSize || 14,
                fontColor: configTextSettings.fontColor || '#000000',
                fontFamily: configTextSettings.fontFamily || themeFont,
                fontWeight: configTextSettings.fontWeight || 'bold',
                haloColor: configTextSettings.haloColor || '#ffffff',
                haloSize: configTextSettings.haloSize ?? 2,
                backgroundColor: configTextSettings.backgroundColor || 'transparent',
                backgroundOpacity: configTextSettings.backgroundOpacity ?? 0.8
            };

            // Always use themeFont if fontFamily is 'Arial' (the old default)
            const effectiveFontFamily = textSettings.fontFamily === 'Arial' ? themeFont : textSettings.fontFamily;

            try {
                // Create text symbol
                const textSymbol = new TextSymbol({
                    text: text.trim(),
                    color: textSettings.fontColor,
                    haloColor: textSettings.haloColor,
                    haloSize: textSettings.haloSize,
                    font: {
                        size: textSettings.fontSize,
                        weight: textSettings.fontWeight,
                        family: effectiveFontFamily
                    },
                    verticalAlignment: 'middle',
                    horizontalAlignment: 'center'
                });

                // Add background if specified
                if (textSettings.backgroundColor && textSettings.backgroundColor !== 'transparent') {
                    textSymbol.backgroundColor = textSettings.backgroundColor;
                    textSymbol.borderLineColor = textSettings.haloColor;
                    textSymbol.borderLineSize = 1;
                }

                const point = new Point({
                    x: location.x,
                    y: location.y,
                    spatialReference: location.spatialReference
                });

                // Create the text graphic
                const textGraphic = new Graphic({
                    geometry: point,
                    symbol: textSymbol,
                    attributes: {
                        type: 'text-graphic',
                        text: text.trim()
                    }
                });

                mapView.graphics.add(textGraphic);

                // Create text graphic object
                const newTextGraphic: TextGraphic = {
                    id: `text-graphic-${Date.now()}`,
                    point: location.clone(),
                    graphic: textGraphic,
                    text: text.trim()
                };

                // Update state
                setState(prev => ({
                    ...prev,
                    textGraphics: [...prev.textGraphics, newTextGraphic],
                    showTextDialog: false,
                    pendingTextLocation: null
                }));

                // Announce success and restore focus
                announce(`Text "${text.trim()}" added to map`);
                previousActiveElement.current?.focus();

            } catch (error) {
                // console.error('Error creating text graphic:', error);
                alert('Error creating text graphic: ' + error.message);
                setState(prev => ({
                    ...prev,
                    showTextDialog: false,
                    pendingTextLocation: null
                }));
            }

        } catch (error) {
            // console.error('Error adding text to map:', error);
            alert(`Error adding text to map: ${error.message}`);
            setState(prev => ({
                ...prev,
                showTextDialog: false,
                pendingTextLocation: null
            }));
        }
    }, [state.pendingTextLocation, props.config?.textSettings, announce, themeFont]);

    // Cancel text input dialog
    const cancelTextInput = React.useCallback(() => {
        setState(prev => ({
            ...prev,
            showTextDialog: false,
            pendingTextLocation: null
        }));
        // Restore focus to previous element
        previousActiveElement.current?.focus();
        announce('Text input cancelled');
    }, [announce]);

    // Open the buffer-choice dialog for Mailing Labels. Mirrors showTextInputDialog:
    // captures the right-clicked point and shows a modal asking the user whether
    // they want a buffer applied — and if so, how big and in what unit. The
    // actual widget launch happens in launchMailingLabels after the user
    // confirms. We reset the error message but keep the user's last
    // distance/unit/enabled choice as defaults across right-clicks in this
    // session (light persistence, no config plumbing needed).
    const showMailingLabelsBufferDialog = React.useCallback(() => {
        const { mapPoint } = state.contextMenu;
        if (!mapPoint) return;

        // Save current focus for restoration when dialog closes
        previousActiveElement.current = document.activeElement as HTMLElement;

        setState(prev => ({
            ...prev,
            showMailingLabelsBufferDialog: true,
            pendingMailingLabelsLocation: mapPoint,
            mailingLabelsBufferError: ''
        }));
    }, [state.contextMenu]);

    // Cancel the mailing labels buffer-choice dialog without launching the widget.
    const cancelMailingLabelsBufferDialog = React.useCallback(() => {
        setState(prev => ({
            ...prev,
            showMailingLabelsBufferDialog: false,
            pendingMailingLabelsLocation: null,
            mailingLabelsBufferError: ''
        }));
        previousActiveElement.current?.focus();
        announce('Mailing Labels cancelled');
    }, [announce]);

    // Open the target widget, handling the parent-container's type correctly:
    //   • 'controller' — close any other open widgets in the controller, then
    //                    open the target (existing widget-controller flow).
    //   • 'accordion'  — open the target so Esri marks it active, then find
    //                    its accordion section header in the DOM and click
    //                    it so the section expands. The DOM-click approach is
    //                    used because Esri's AccordionLayoutViewer manages
    //                    section state internally and `expandedItems` in the
    //                    saved config is only the initial state, not a live
    //                    runtime API.
    //   • 'none'       — just open the target widget (top-level, no parent).
    //
    // Errors are swallowed silently inside try/catch so a misconfigured parent
    // never blocks the actual action from firing.
    // Open the target widget, handling the parent-container's type correctly:
    //   • 'controller'           — close any other open widgets in the
    //                              controller, then open the target (existing
    //                              widget-controller flow).
    //   • 'accordion'            — open the target so Esri marks it active,
    //                              then find its accordion section header in
    //                              the DOM and click it so the section
    //                              expands. The DOM-click approach is used
    //                              because Esri's AccordionLayoutViewer
    //                              manages section state internally and
    //                              `expandedItems` in the saved config is
    //                              only the initial state, not a live
    //                              runtime API.
    //   • 'controller+accordion' — accordion is itself inside a widget
    //                              controller. Open the controller panel
    //                              for the accordion widget first, then
    //                              expand the accordion section that owns
    //                              the target widget.
    //   • 'none'                 — just open the target widget (top-level,
    //                              no parent).
    //
    // Errors are swallowed silently inside try/catch so a misconfigured parent
    // never blocks the actual action from firing.
    const openContainerAndTarget = React.useCallback((
        targetWidgetId: string,
        containerType?: 'controller' | 'accordion' | 'controller+accordion' | 'none',
        accordionWidgetIdOverride?: string
    ) => {
        const type = containerType || 'controller';

        // Open a widget through the widget-controller panel flow: close any
        // currently-open widgets so the controller releases its existing
        // panel, then open the target. The asMutable / state-shape
        // inspection is defensive — `widgetsRuntimeInfo`'s shape varies
        // across ExB versions.
        const openInController = (widgetId: string, openDelay: number) => {
            try {
                const appState = getAppStore().getState();
                const runtimeInfo = appState?.widgetsRuntimeInfo;
                if (runtimeInfo) {
                    const ri = typeof runtimeInfo.asMutable === 'function'
                        ? runtimeInfo.asMutable({ deep: true })
                        : runtimeInfo;
                    const openIds = Object.keys(ri).filter(id => {
                        const info: any = ri[id];
                        return info?.state === 'OPENED' || info?.isOpened;
                    });
                    if (openIds.length > 0) {
                        getAppStore().dispatch(appActions.closeWidgets(openIds));
                    }
                }
            } catch { /* silent */ }

            try {
                getAppStore().dispatch((appActions as any).closeWidget(widgetId));
            } catch { /* silent */ }

            setTimeout(() => {
                try {
                    getAppStore().dispatch(appActions.openWidgets([widgetId]));
                } catch { /* silent */ }
            }, openDelay);
        };

        // Walk the accordion DOM and click the header whose section contains
        // (or whose label matches) the target widget. Returns true if a
        // header was found and clicked (or was already expanded).
        const expandAccordionSection = (accordionId: string): boolean => {
            try {
                let accordionRoot: Element | null = null;
                if (accordionId) {
                    const accordionSelectors = [
                        `[data-widgetid="${accordionId}"]`,
                        `[data-widget-id="${accordionId}"]`,
                        `[data-id="${accordionId}"]`,
                        `#${accordionId}`
                    ];
                    for (const s of accordionSelectors) {
                        try { accordionRoot = document.querySelector(s); } catch { /* ignore */ }
                        if (accordionRoot) break;
                    }
                }
                const searchRoot: Element | Document = accordionRoot || document;

                // Find the target widget's DOM. Esri may have unmounted it
                // (collapsed accordion sections detach their content), so
                // fall back to a document-wide search if needed.
                const targetSelectors = [
                    `[data-widgetid="${targetWidgetId}"]`,
                    `[data-widget-id="${targetWidgetId}"]`,
                    `[data-id="${targetWidgetId}"]`,
                    `#${targetWidgetId}`
                ];
                let widgetEl: Element | null = null;
                for (const s of targetSelectors) {
                    try { widgetEl = (searchRoot as any).querySelector(s); } catch { /* ignore */ }
                    if (widgetEl) break;
                }
                if (!widgetEl && accordionRoot) {
                    for (const s of targetSelectors) {
                        try { widgetEl = document.querySelector(s); } catch { /* ignore */ }
                        if (widgetEl) break;
                    }
                }

                // Enumerate candidate section headers via aria-expanded —
                // canonical ARIA attribute for a collapsible.
                const headerCandidates: HTMLElement[] = [];
                const queryRoot = accordionRoot || document;
                queryRoot.querySelectorAll('[aria-expanded]').forEach(el => {
                    headerCandidates.push(el as HTMLElement);
                });

                // Strategy A: target widget DOM exists — find the header
                // whose section contains it.
                if (widgetEl && headerCandidates.length > 0) {
                    for (const h of headerCandidates) {
                        let p: Element | null = h.parentElement;
                        while (p && p !== document.body) {
                            if (p.contains(widgetEl)) {
                                if (h.getAttribute('aria-expanded') === 'true') return true;
                                h.click();
                                return true;
                            }
                            p = p.parentElement;
                        }
                    }
                }

                // Strategy B: widget hasn't mounted yet (section is
                // collapsed). Match header by label text against the
                // widget's configured label.
                if (!widgetEl && accordionRoot && headerCandidates.length > 0) {
                    let targetLabel = '';
                    try {
                        const appState: any = getAppStore().getState();
                        const cfg = appState?.appStateInBuilder?.appConfig || appState?.appConfig;
                        targetLabel = String(cfg?.widgets?.[targetWidgetId]?.label || '');
                    } catch { /* ignore */ }
                    if (targetLabel) {
                        const norm = (s: string) => s.toLowerCase().trim();
                        const target = norm(targetLabel);
                        for (const h of headerCandidates) {
                            const txt = norm(h.textContent || '');
                            if (txt && (txt === target || txt.indexOf(target) >= 0 || target.indexOf(txt) >= 0)) {
                                if (h.getAttribute('aria-expanded') !== 'true') h.click();
                                return true;
                            }
                        }
                    }
                }

                return false;
            } catch {
                return false;
            }
        };

        // Retry-on-a-schedule wrapper for expandAccordionSection — Esri
        // can lazy-mount accordion sections only after they've been
        // requested, so we keep trying until the section actually exists.
        // baseDelay shifts the schedule when the accordion itself is
        // inside a controller that has to open first.
        const scheduleAccordionExpansion = (accordionId: string, baseDelay: number) => {
            setTimeout(() => {
                if (!expandAccordionSection(accordionId)) {
                    setTimeout(() => expandAccordionSection(accordionId), 400);
                }
            }, baseDelay + 150);
            setTimeout(() => expandAccordionSection(accordionId), baseDelay + 900);
            setTimeout(() => expandAccordionSection(accordionId), baseDelay + 1700);
        };

        // Resolve the accordion widget id from the override or from saved
        // settings (mirrors what the launcher passes — works for both the
        // property report and mailing labels code paths).
        const resolvedAccordionId =
            accordionWidgetIdOverride
            || (props.config?.propertyReportSettings?.targetWidgetId === targetWidgetId
                ? props.config?.propertyReportSettings?.accordionWidgetId
                : props.config?.mailingLabelsSettings?.accordionWidgetId)
            || '';

        if (type === 'controller') {
            openInController(targetWidgetId, 100);
            return;
        }

        if (type === 'accordion') {
            // No outer controller — just open the target so it's marked
            // active, then expand its accordion section.
            try {
                getAppStore().dispatch(appActions.openWidgets([targetWidgetId]));
            } catch { /* silent */ }

            // The accordion id for the plain-accordion case comes from
            // parentControllerId (kept for backwards compatibility — when
            // there's no outer controller, that field holds the accordion
            // widget id directly).
            const accordionIdForFlat =
                resolvedAccordionId
                || (props.config?.propertyReportSettings?.targetWidgetId === targetWidgetId
                    ? props.config?.propertyReportSettings?.parentControllerId
                    : props.config?.mailingLabelsSettings?.parentControllerId)
                || '';
            scheduleAccordionExpansion(accordionIdForFlat, 0);
            return;
        }

        if (type === 'controller+accordion') {
            // The accordion lives inside a widget controller. We need to:
            //   1. Open the controller's panel for the accordion widget (the
            //      controller treats the accordion as its content); this
            //      mounts the accordion's DOM.
            //   2. Mark the target widget as opened in Redux.
            //   3. Find the target's foldable-panel inside the accordion DOM
            //      and click its header so the accordion expands that
            //      section. Esri's accordion section is one <foldable-panel>
            //      element containing a "panel d-flex flex-column" wrapper,
            //      which in turn holds a "panel-header" and the body — we
            //      walk down to the header and click it.
            if (!resolvedAccordionId) {
                // Misconfigured — fall back to plain controller mode on the
                // target so something still opens.
                openInController(targetWidgetId, 100);
                return;
            }

            // Step 1: open the accordion widget through its controller.
            openInController(resolvedAccordionId, 100);

            // Step 2: dispatch openWidgets on the target so Redux marks it
            // as active — some Esri code paths rely on this for the
            // accordion's initial section selection.
            setTimeout(() => {
                try {
                    getAppStore().dispatch(appActions.openWidgets([targetWidgetId]));
                } catch { /* silent */ }
            }, 400);

            // Step 3: expand the section containing the target widget.
            const tryExpand = (): boolean => {
                try {
                    let accordionRoot: Element | null = null;
                    const accordionSelectors = [
                        `[data-widgetid="${resolvedAccordionId}"]`,
                        `[data-widget-id="${resolvedAccordionId}"]`,
                        `[data-id="${resolvedAccordionId}"]`,
                        `#${resolvedAccordionId}`
                    ];
                    for (const s of accordionSelectors) {
                        try { accordionRoot = document.querySelector(s); } catch { /* ignore */ }
                        if (accordionRoot) break;
                    }
                    if (!accordionRoot) return false;

                    let widgetEl: Element | null = null;
                    const targetSelectors = [
                        `[data-widgetid="${targetWidgetId}"]`,
                        `[data-widget-id="${targetWidgetId}"]`,
                        `[data-id="${targetWidgetId}"]`,
                        `#${targetWidgetId}`
                    ];
                    for (const s of targetSelectors) {
                        try { widgetEl = document.querySelector(s); } catch { /* ignore */ }
                        if (widgetEl) break;
                    }
                    if (!widgetEl) return false;

                    // Walk up from the widget to its containing foldable-panel.
                    let foldablePanel: Element | null = null;
                    let cur: Element | null = widgetEl;
                    let depth = 0;
                    while (cur && depth < 15) {
                        const cls = cur.getAttribute('class') || '';
                        if (cls.indexOf('foldable-panel') >= 0) {
                            foldablePanel = cur;
                            break;
                        }
                        cur = cur.parentElement;
                        depth++;
                    }
                    if (!foldablePanel) return false;

                    // Already expanded? we're done.
                    if ((foldablePanel.getAttribute('class') || '').indexOf('collapsed') < 0) {
                        return true;
                    }

                    // Recursively descend the panel looking for the FIRST
                    // descendant that does NOT contain the widget — that's
                    // the section header (typically a "panel-header" div
                    // with the section title and an expand button).
                    const findHeader = (node: Element, d: number): Element | null => {
                        if (d > 6) return null;
                        for (const c of Array.from(node.children)) {
                            if (!widgetEl || !c.contains(widgetEl)) {
                                if ((c.textContent || '').trim().length > 0) return c;
                            }
                        }
                        for (const c of Array.from(node.children)) {
                            if (widgetEl && c.contains(widgetEl)) {
                                const found = findHeader(c, d + 1);
                                if (found) return found;
                            }
                        }
                        return null;
                    };
                    const header = findHeader(foldablePanel, 0);

                    if (header) {
                        const btn = header.querySelector('button, [role="button"]') as HTMLElement | null;
                        if (btn) {
                            btn.click();
                            return true;
                        }
                        (header as HTMLElement).click();
                        return true;
                    }

                    // Last resort — click the panel itself.
                    (foldablePanel as HTMLElement).click();
                    return true;
                } catch {
                    return false;
                }
            };

            // Schedule retries: the accordion's DOM may not be mounted on
            // the first frame after the controller dispatches its open.
            setTimeout(tryExpand, 650);
            setTimeout(tryExpand, 1400);
            setTimeout(tryExpand, 2200);
            return;
        }

        // type === 'none' — just open the target. No parent container to
        // coordinate with.
        try {
            getAppStore().dispatch(appActions.openWidgets([targetWidgetId]));
        } catch { /* silent */ }
    }, [
        props.config?.propertyReportSettings?.targetWidgetId,
        props.config?.propertyReportSettings?.parentControllerId,
        props.config?.propertyReportSettings?.accordionWidgetId,
        props.config?.mailingLabelsSettings?.targetWidgetId,
        props.config?.mailingLabelsSettings?.parentControllerId,
        props.config?.mailingLabelsSettings?.accordionWidgetId
    ]);

    // Launch the Mailing Labels widget at the captured right-click location.
    // Follows the same controller-aware open/close pattern used by the Property
    // Report action: close any open widgets in the controller, open the target,
    // and push the action payload through MutableStoreManager.
    //
    // Buffer handling: the dialog has a checkbox + distance input + unit
    // dropdown. When the checkbox is on, we validate the typed distance and
    // include it in the payload as { applyBuffer: true, bufferDistance, bufferUnit }.
    // When off, we send { applyBuffer: false } and the receiving widget zeros
    // out its buffer for this selection.
    const launchMailingLabels = React.useCallback(() => {
        const pendingPoint = state.pendingMailingLabelsLocation;
        const targetWidgetId = props.config?.mailingLabelsSettings?.targetWidgetId;
        const applyBuffer = state.mailingLabelsBufferEnabled;
        const bufferUnit = state.mailingLabelsBufferUnit;

        // Resolve distance only if the user wants a buffer. Otherwise the value
        // is ignored on the receiving side, so we don't need to validate.
        let bufferDistance: number | null = null;
        if (applyBuffer) {
            const raw = state.mailingLabelsBufferDistance.trim();
            const parsed = Number(raw);
            if (raw === '' || !isFinite(parsed) || parsed <= 0) {
                // Inline validation — keep the dialog open and surface the error.
                setState(prev => ({
                    ...prev,
                    mailingLabelsBufferError: 'Please enter a buffer distance greater than 0.'
                }));
                return;
            }
            bufferDistance = parsed;
        }

        // All checks passed — close the dialog before opening the widget.
        setState(prev => ({
            ...prev,
            showMailingLabelsBufferDialog: false,
            pendingMailingLabelsLocation: null,
            mailingLabelsBufferError: ''
        }));
        previousActiveElement.current?.focus();

        if (!pendingPoint || !targetWidgetId) return;

        try {
            const pointData = {
                x: pendingPoint.x,
                y: pendingPoint.y,
                spatialReference: pendingPoint.spatialReference?.toJSON?.() || pendingPoint.spatialReference || { wkid: 4326 }
            };

            // Open the target (and expand the accordion section, or open in
            // the widget controller, depending on what the dev configured).
            const containerType = props.config?.mailingLabelsSettings?.parentContainerType;
            openContainerAndTarget(targetWidgetId, containerType);

            // Push the action payload through MutableStoreManager with the
            // same staggered retries the property-report path uses, so we
            // catch cases where the target widget is still mid-mount when
            // the first message goes out.
            const sendPoint = (delay: number) => {
                setTimeout(() => {
                    try {
                        MutableStoreManager.getInstance().updateStateValue(targetWidgetId, 'actionPoint', {
                            point: pointData,
                            address: null,
                            autoOpenSection: null,
                            applyBuffer,
                            bufferDistance,
                            bufferUnit,
                            timestamp: Date.now()
                        });
                        getAppStore().dispatch(
                            appActions.widgetStatePropChange(targetWidgetId, 'actionTriggered', true)
                        );
                    } catch { /* silent */ }
                }, delay);
            };

            // First send goes a bit after the open is dispatched (the helper
            // already waits ~100ms for controllers); subsequent sends are
            // belt-and-suspenders against slow mounts.
            sendPoint(350);
            sendPoint(1000);
            sendPoint(1800);
        } catch (err) {
            console.error('Right-Click: Error triggering Mailing Labels widget', err);
        }
    }, [
        state.pendingMailingLabelsLocation,
        state.mailingLabelsBufferEnabled,
        state.mailingLabelsBufferDistance,
        state.mailingLabelsBufferUnit,
        props.config?.mailingLabelsSettings?.targetWidgetId,
        props.config?.mailingLabelsSettings?.parentContainerType,
        openContainerAndTarget
    ]);

    // Clear all text graphics
    const clearTextGraphics = React.useCallback(() => {
        const mapView = mapViewRef.current;
        if (!mapView) return;

        // Remove all text graphics from map
        const textGraphics = mapView.graphics.filter((graphic: any) => {
            return graphic.attributes?.type === 'text-graphic';
        });

        const count = textGraphics.length;
        mapView.graphics.removeMany(textGraphics.toArray());

        // Reset state
        setState(prev => ({
            ...prev,
            textGraphics: []
        }));

        announce(`${count} text graphics cleared`);
    }, [announce]);

    // Plot coordinate marker function
    const plotCoordinate = React.useCallback(() => {
        const { mapPoint, projectedLatLon } = state.contextMenu;
        const mapView = mapViewRef.current;
        if (!mapView || !mapPoint) return;

        try {
            const plotSettings = props.config?.plotSettings || {
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
                coordinateSystem: 'map',
                customWkid: undefined,
                coordinateFormat: 'decimal',
                decimalPlaces: 6,
                labelOffset: 20,
                labelTextSize: 10,
                labelTextColor: '#000000'
            };

            let coordinateText: string;
            let coordinateLabel: string;

            // Use pre-computed projectedLatLon from state (set async on right-click)
            // for webMercator mode. Falls back to accurate Transverse Mercator math.
            if (plotSettings.coordinateSystem === 'webMercator') {
                const { lat, lon } = projectedLatLon ?? manualProjectToLatLon(mapPoint);
                if (plotSettings.coordinateFormat === 'dms') {
                    coordinateText = `${convertToDMS(lat, 'lat')}\n${convertToDMS(lon, 'lon')}`;
                    coordinateLabel = coordinateText;
                } else {
                    const latDir = lat >= 0 ? 'N' : 'S';
                    const lonDir = lon >= 0 ? 'E' : 'W';
                    coordinateText = `Lat: ${Math.abs(lat).toFixed(plotSettings.decimalPlaces || 6)}° ${latDir}\nLon: ${Math.abs(lon).toFixed(plotSettings.decimalPlaces || 6)}° ${lonDir}`;
                    coordinateLabel = `${Math.abs(lat).toFixed(plotSettings.decimalPlaces || 6)}° ${latDir}\n${Math.abs(lon).toFixed(plotSettings.decimalPlaces || 6)}° ${lonDir}`;
                }
            } else if (plotSettings.coordinateSystem === 'custom' && plotSettings.customWkid) {
                coordinateText = `X: ${mapPoint.x.toFixed(plotSettings.decimalPlaces || 2)}\nY: ${mapPoint.y.toFixed(plotSettings.decimalPlaces || 2)}\nWKID: ${plotSettings.customWkid}`;
                coordinateLabel = `${mapPoint.x.toFixed(plotSettings.decimalPlaces || 2)}, ${mapPoint.y.toFixed(plotSettings.decimalPlaces || 2)}`;
            } else {
                // Use map's native coordinate system
                coordinateText = `X: ${mapPoint.x.toFixed(plotSettings.decimalPlaces || 2)}\nY: ${mapPoint.y.toFixed(plotSettings.decimalPlaces || 2)}\nWKID: ${mapPoint.spatialReference?.wkid || 'Unknown'}`;
                coordinateLabel = `${mapPoint.x.toFixed(plotSettings.decimalPlaces || 2)}, ${mapPoint.y.toFixed(plotSettings.decimalPlaces || 2)}`;
            }

            try {
                const markerNumber = state.nextMarkerNumber;

                // NEW: Create enhanced marker symbol with all style options
                const markerSymbol = new SimpleMarkerSymbol({
                    color: plotSettings.markerColor,
                    outline: {
                        color: plotSettings.markerOutlineColor || '#ffffff',
                        width: plotSettings.markerOutlineWidth || 1
                    },
                    size: plotSettings.markerSize,
                    style: (plotSettings.markerStyle || 'circle') as any,
                    // Add rotation, offsets, and opacity
                    angle: plotSettings.markerAngle || 0,
                    xoffset: plotSettings.markerXOffset || 0,
                    yoffset: plotSettings.markerYOffset || 0
                });

                // Apply opacity if supported
                if (plotSettings.markerOpacity !== undefined && plotSettings.markerOpacity !== 1) {
                    markerSymbol.color = [
                        ...markerSymbol.color.toRgb(),
                        plotSettings.markerOpacity
                    ] as any;
                }

                // Create the number text symbol
                const numberSymbol = new TextSymbol({
                    text: markerNumber.toString(),
                    color: plotSettings.textColor,
                    font: {
                        size: plotSettings.textSize,
                        weight: 'bold',
                        family: themeFont
                    },
                    verticalAlignment: 'middle',
                    horizontalAlignment: 'center',
                    // Apply same offsets to text as marker
                    xoffset: plotSettings.markerXOffset || 0,
                    yoffset: plotSettings.markerYOffset || 0
                });

                const point = new Point({
                    x: mapPoint.x,
                    y: mapPoint.y,
                    spatialReference: mapPoint.spatialReference
                });

                // Create popup content
                let popupContent = `<div style="font-family: ${themeFont}; font-size: 12px; line-height: 1.6; padding: 8px;">`;
                popupContent += `<div style="font-weight: bold; margin-bottom: 8px;">Marker ${markerNumber}</div>`;

                if (plotSettings.showCoordinateText) {
                    popupContent += `<div style="background-color: #f5f5f5; padding: 6px; border-radius: 3px; white-space: pre-line;">${coordinateText}</div>`;
                }

                popupContent += `</div>`;

                // Create the marker graphic
                const markerGraphic = new Graphic({
                    geometry: point,
                    symbol: markerSymbol,
                    attributes: {
                        type: 'coordinate-marker',
                        number: markerNumber,
                        coordinates: coordinateText,
                        originalX: mapPoint.x,
                        originalY: mapPoint.y,
                        wkid: mapPoint.spatialReference?.wkid
                    },
                    popupTemplate: {
                        title: `📍 Coordinate Marker ${markerNumber}`,
                        content: popupContent
                    } as any
                });

                // Create the number text graphic
                const textGraphic = new Graphic({
                    geometry: point,
                    symbol: numberSymbol,
                    attributes: {
                        type: 'coordinate-text',
                        parentMarker: markerNumber
                    }
                });

                // Add the main graphics first
                mapView.graphics.addMany([markerGraphic, textGraphic]);

                // Create coordinate label graphic (if enabled)
                if (plotSettings.showCoordinateLabels !== false) { // Default to true if undefined

                    // Calculate offset position for label - use a simple pixel-based offset
                    const offsetPixels = plotSettings.labelOffset || 20;
                    const currentScale = mapView.scale;
                    const mapUnitsPerPixel = currentScale / 96 / 39.37; // Convert to map units
                    const offsetMapUnits = offsetPixels * mapUnitsPerPixel;

                    const labelPoint = new Point({
                        x: mapPoint.x + offsetMapUnits,
                        y: mapPoint.y - offsetMapUnits, // Offset down and right
                        spatialReference: mapPoint.spatialReference
                    });

                    // Create label symbol
                    const labelSymbol = new TextSymbol({
                        text: coordinateLabel,
                        color: plotSettings.labelTextColor || '#000000',
                        haloColor: '#ffffff',
                        haloSize: 2,
                        font: {
                            size: plotSettings.labelTextSize || 10,
                            weight: 'normal',
                            family: themeFont
                        },
                        verticalAlignment: 'top',
                        horizontalAlignment: 'left'
                    });

                    const labelGraphic = new Graphic({
                        geometry: labelPoint,
                        symbol: labelSymbol,
                        attributes: {
                            type: 'coordinate-label',
                            parentMarker: markerNumber
                        }
                    });

                    mapView.graphics.add(labelGraphic);
                }

                // Create coordinate marker object
                const newMarker: CoordinateMarker = {
                    id: `marker-${markerNumber}`,
                    number: markerNumber,
                    point: mapPoint.clone(),
                    graphic: markerGraphic,
                    coordinateText: coordinateText
                };

                // Update state
                setState(prev => ({
                    ...prev,
                    coordinateMarkers: [...prev.coordinateMarkers, newMarker],
                    nextMarkerNumber: prev.nextMarkerNumber + 1
                }));

                // Announce success
                announce(`Coordinate marker ${markerNumber} placed on map`);

            } catch (error) {
                // console.error('Error creating coordinate marker:', error);
                alert('Error creating coordinate marker: ' + error.message);
            }

        } catch (error) {
            // console.error('Error plotting coordinate:', error);
            alert(`Error plotting coordinate: ${error.message}`);
        }
    }, [state.contextMenu, state.nextMarkerNumber, props.config?.plotSettings, manualProjectToLatLon, convertToDMS, announce, themeFont]);

    // Plot simple marker function
    const plotSimpleMarker = React.useCallback(() => {
        const { mapPoint } = state.contextMenu;
        const mapView = mapViewRef.current;
        if (!mapView || !mapPoint) return;

        try {
            const markerSettings = props.config?.markerSettings || {
                markerSize: 8,
                markerColor: '#0078ff',
                markerStyle: 'circle',
                markerOutlineColor: '#ffffff',
                markerOutlineWidth: 1,
                markerOpacity: 1,
                markerAngle: 0,
                markerXOffset: 0,
                markerYOffset: 0
            };

            try {
                // NEW: Create enhanced simple marker symbol with all style options
                const markerSymbol = new SimpleMarkerSymbol({
                    color: markerSettings.markerColor,
                    outline: {
                        color: markerSettings.markerOutlineColor || '#ffffff',
                        width: markerSettings.markerOutlineWidth || 1
                    },
                    size: markerSettings.markerSize,
                    style: (markerSettings.markerStyle || 'circle') as any,
                    // Add rotation, offsets
                    angle: markerSettings.markerAngle || 0,
                    xoffset: markerSettings.markerXOffset || 0,
                    yoffset: markerSettings.markerYOffset || 0
                });

                // Apply opacity if supported
                if (markerSettings.markerOpacity !== undefined && markerSettings.markerOpacity !== 1) {
                    markerSymbol.color = [
                        ...markerSymbol.color.toRgb(),
                        markerSettings.markerOpacity
                    ] as any;
                }

                const point = new Point({
                    x: mapPoint.x,
                    y: mapPoint.y,
                    spatialReference: mapPoint.spatialReference
                });

                // Create the marker graphic
                const markerGraphic = new Graphic({
                    geometry: point,
                    symbol: markerSymbol,
                    attributes: {
                        type: 'simple-marker'
                    }
                    // No popup template - just a simple marker
                });

                mapView.graphics.add(markerGraphic);

                // Create simple marker object
                const newMarker: SimpleMarker = {
                    id: `simple-marker-${Date.now()}`,
                    point: mapPoint.clone(),
                    graphic: markerGraphic
                };

                // Update state
                setState(prev => ({
                    ...prev,
                    simpleMarkers: [...prev.simpleMarkers, newMarker]
                }));

                // Announce success
                announce('Marker placed on map');

            } catch (error) {
                // console.error('Error creating simple marker:', error);
                alert('Error creating simple marker: ' + error.message);
            }

        } catch (error) {
            // console.error('Error plotting simple marker:', error);
            alert(`Error plotting simple marker: ${error.message}`);
        }
    }, [state.contextMenu, props.config?.markerSettings, announce]);

    // Clear all coordinate markers
    const clearCoordinateMarkers = React.useCallback(() => {
        const mapView = mapViewRef.current;
        if (!mapView) return;

        // Remove all coordinate graphics from map
        const coordinateGraphics = mapView.graphics.filter((graphic: any) => {
            return graphic.attributes?.type === 'coordinate-marker' ||
                graphic.attributes?.type === 'coordinate-text' ||
                graphic.attributes?.type === 'coordinate-label';
        });

        const count = coordinateGraphics.length;
        mapView.graphics.removeMany(coordinateGraphics.toArray());

        // Reset state
        setState(prev => ({
            ...prev,
            coordinateMarkers: [],
            nextMarkerNumber: 1
        }));

        announce(`${count} coordinate markers cleared`);
    }, [announce]);

    // Clear all simple markers
    const clearSimpleMarkers = React.useCallback(() => {
        const mapView = mapViewRef.current;
        if (!mapView) return;

        // Remove all simple marker graphics from map
        const simpleMarkerGraphics = mapView.graphics.filter((graphic: any) => {
            return graphic.attributes?.type === 'simple-marker';
        });

        const count = simpleMarkerGraphics.length;
        mapView.graphics.removeMany(simpleMarkerGraphics.toArray());

        // Reset state
        setState(prev => ({
            ...prev,
            simpleMarkers: []
        }));

        announce(`${count} markers cleared`);
    }, [announce]);

    // Clear all graphics
    const clearAllGraphics = React.useCallback(() => {
        const mapView = mapViewRef.current;
        if (!mapView) return;

        // Remove ALL graphics from map (markers + text + measurement labels)
        const allGraphics = mapView.graphics.filter((graphic: any) => {
            return graphic.attributes?.type === 'coordinate-marker' ||
                graphic.attributes?.type === 'coordinate-text' ||
                graphic.attributes?.type === 'coordinate-label' ||
                graphic.attributes?.type === 'simple-marker' ||
                graphic.attributes?.type === 'text-graphic' ||
                graphic.attributes?.type === 'segment-label' ||
                graphic.attributes?.type === 'total-label' ||
                graphic.attributes?.type === 'area-label' ||
                graphic.attributes?.type === 'perimeter-label' ||
                graphic.attributes?.type === 'measurement-graphic';
        });

        const count = allGraphics.length;
        mapView.graphics.removeMany(allGraphics.toArray());

        // Reset all states
        setState(prev => ({
            ...prev,
            coordinateMarkers: [],
            nextMarkerNumber: 1,
            simpleMarkers: [],
            textGraphics: []
        }));

        announce(`${count} graphics cleared from map`);
    }, [announce]);

    const openStreetView = React.useCallback(() => {
        const { mapPoint, projectedLatLon } = state.contextMenu;
        if (!mapViewRef.current || !mapPoint) return;

        // Use pre-computed projectedLatLon (set async on right-click, accurate by the time
        // user clicks the menu item). Fall back to manual math if not yet available.
        const { lat, lon } = projectedLatLon ?? manualProjectToLatLon(mapPoint);

        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            alert('Invalid coordinates - cannot open Street View');
            return;
        }

        const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
        window.open(streetViewUrl, '_blank');
    }, [state.contextMenu, manualProjectToLatLon]);

    const openPictometryView = React.useCallback(() => {
        const { mapPoint, projectedLatLon } = state.contextMenu;
        if (!mapViewRef.current || !mapPoint || !props.config?.pictometryUrl) return;

        // Use pre-computed projectedLatLon (set async on right-click, accurate by the time
        // user clicks the menu item). Fall back to manual math if not yet available.
        const { lat, lon } = projectedLatLon ?? manualProjectToLatLon(mapPoint);

        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            alert('Invalid coordinates - cannot open Pictometry');
            return;
        }

        const pictometryUrl = `${props.config.pictometryUrl}?x=${lon.toFixed(14)}&y=${lat.toFixed(14)}`;
        window.open(pictometryUrl, '_blank');
    }, [state.contextMenu, manualProjectToLatLon, props.config?.pictometryUrl]);

    const startMeasurement = React.useCallback(async () => {
        const mapView = mapViewRef.current;
        if (!mapView) return;

        try {
            if (state.measurementWidget) {
                if ((state.measurementWidget as any).__disconnectObserver) {
                    (state.measurementWidget as any).__disconnectObserver();
                }
                state.measurementWidget.destroy();
            }

            // Only remove DISTANCE measurement labels, preserve area labels
            const measurementGraphics = mapView.graphics.filter((graphic: any) => {
                return graphic.attributes?.type === 'segment-label' ||
                    graphic.attributes?.type === 'total-label' ||
                    graphic.attributes?.type === 'measurement-graphic';
            });
            mapView.graphics.removeMany(measurementGraphics.toArray());

            const validUnits = ['feet', 'yards', 'miles', 'meters', 'kilometers'];
            const measurementSettings = props.config?.measurementSettings || {
                defaultUnits: 'feet',
                unitDisplay: 'single'
            };

            // Snapshot layers BEFORE widget creation
            const labelSuppressor = createLabelSuppressor(mapView);
            labelSuppressor.snapshotLayers();

            (window as any).require([
                'esri/widgets/DistanceMeasurement2D',
                'esri/Graphic',
                'esri/symbols/TextSymbol',
                'esri/geometry/geometryEngine',
                'esri/geometry/Point',
                'esri/geometry/Polyline'
            ], (DistanceMeasurement2D: any, Graphic: any, TextSymbol: any, geometryEngine: any, Point: any, Polyline: any) => {
                try {
                    const distanceMeasurement2D = new DistanceMeasurement2D({
                        view: mapView,
                        unitOptions: validUnits as any
                    });

                    // Suppress ESRI's built-in on-map text labels
                    const cancelLabelSuppression = labelSuppressor.startSuppression();

                    let primaryUnit: string = 'feet';
                    let secondaryUnit: string | null = null;

                    if (validUnits.includes(measurementSettings.defaultUnits)) {
                        primaryUnit = measurementSettings.defaultUnits;
                    }

                    if (measurementSettings.unitDisplay === 'both') {
                        switch (primaryUnit) {
                            case 'feet': secondaryUnit = 'meters'; break;
                            case 'meters': secondaryUnit = 'feet'; break;
                            case 'miles': secondaryUnit = 'kilometers'; break;
                            case 'kilometers': secondaryUnit = 'miles'; break;
                            case 'yards': secondaryUnit = 'meters'; break;
                        }
                    }

                    const initializeDistanceUnit = () => {
                        try {
                            distanceMeasurement2D.unit = primaryUnit;
                            if (distanceMeasurement2D.viewModel) {
                                distanceMeasurement2D.viewModel.unit = primaryUnit;
                            }
                        } catch (e) {
                            // console.warn('Error setting initial distance unit:', e);
                        }
                    };

                    mapView.ui.add(distanceMeasurement2D, 'top-right');
                    initializeDistanceUnit();

                    distanceMeasurement2D.when(() => {
                        const disconnectObserver = hideUnwantedUnits(distanceMeasurement2D, 'distance');
                        // Store disconnect so cleanup can call it
                        (distanceMeasurement2D as any).__disconnectObserver = disconnectObserver;
                        setTimeout(() => initializeDistanceUnit(), 100);
                        setTimeout(() => initializeDistanceUnit(), 300);
                        setTimeout(() => initializeDistanceUnit(), 500);
                    });

                    setTimeout(() => {
                        distanceMeasurement2D.viewModel.start();
                        initializeDistanceUnit();
                    }, 200);

                    const formatDistance = (distance: number, unit: string): string => {
                        let formatted = `${distance.toFixed(2)} ${unit}`;
                        if (secondaryUnit && measurementSettings.unitDisplay === 'both') {
                            const conversions: Record<string, number> = {
                                'feet->meters': 0.3048, 'meters->feet': 3.28084,
                                'miles->kilometers': 1.60934, 'kilometers->miles': 0.621371,
                                'yards->meters': 0.9144, 'meters->yards': 1.09361
                            };
                            const key = `${unit}->${secondaryUnit}`;
                            const factor = conversions[key] ?? 1;
                            const converted = distance * factor;
                            formatted += ` (${converted.toFixed(2)} ${secondaryUnit})`;
                        }
                        return formatted;
                    };

                    const createLabel = (pt: __esri.Point, text: string, attrType: string) => {
                        const label = new Graphic({
                            geometry: pt,
                            symbol: new TextSymbol({
                                text,
                                color: [255, 255, 255],
                                haloColor: [0, 0, 0],
                                haloSize: 2,
                                font: { size: 12, family: themeFont, weight: 'bold' },
                                verticalAlignment: 'middle',
                                horizontalAlignment: 'center'
                            }),
                            attributes: { type: attrType }
                        });
                        mapView.graphics.add(label);
                    };

                    const drawLabels = (geometry: __esri.Geometry, unit: string) => {
                        const polyline = geometry as __esri.Polyline;
                        const path = polyline.paths?.[0];
                        if (!path) return;

                        const points = path.map(([x, y]) => new Point({
                            x, y,
                            spatialReference: mapView.spatialReference
                        }));

                        let total = 0;

                        // Synchronous distance calculation — no nested require needed.
                        // geometryEngine and Polyline are already loaded from the outer require.
                        // Strategy: geodesicLength (needs WASM, works on Portal) →
                        //           planarLength (no WASM, handles any projected SR) →
                        //           Euclidean math fallback.
                        const calculateAccurateDistance = (point1: any, point2: any, unit: string): number => {
                            try {
                                const line = new Polyline({
                                    paths: [[[point1.x, point1.y], [point2.x, point2.y]]],
                                    spatialReference: point1.spatialReference
                                });

                                // Primary: geodesic (correct for any SR, needs WASM - works on Portal)
                                try {
                                    const geodesic = geometryEngine.geodesicLength(line, unit);
                                    if (geodesic > 0) {
                                        return geodesic;
                                    }
                                } catch (e) {
                                }

                                // Fallback: planar (no WASM, converts units via JSAPI, any projected SR)
                                try {
                                    const planar = geometryEngine.planarLength(line, unit);
                                    if (planar > 0) {
                                        return planar;
                                    }
                                } catch (e) {
                                }

                                // Last resort: Euclidean math
                                const dx = point2.x - point1.x;
                                const dy = point2.y - point1.y;
                                const rawDist = Math.sqrt(dx * dx + dy * dy);
                                const unitConversions: Record<string, number> = {
                                    'feet': 3.28084, 'yards': 1.09361, 'miles': 0.000621371,
                                    'kilometers': 0.001, 'meters': 1
                                };
                                const euclidean = rawDist * (unitConversions[unit] ?? 1);
                                return euclidean;
                            } catch (e) {
                                return 0;
                            }
                        };

                        // Calculate distances for each segment (sync - no await needed)
                        for (let i = 0; i < points.length - 1; i++) {
                            const seg = calculateAccurateDistance(points[i], points[i + 1], unit);
                            total += seg;

                            const mid = new Point({
                                x: (points[i].x + points[i + 1].x) / 2,
                                y: (points[i].y + points[i + 1].y) / 2,
                                spatialReference: mapView.spatialReference
                            });
                            createLabel(mid, formatDistance(seg, unit), 'segment-label');
                        }

                        if (points.length > 1) {
                            const lastPoint = points[points.length - 1];
                            const offset = new Point({
                                x: lastPoint.x,
                                y: lastPoint.y + (mapView.extent.height * 0.01),
                                spatialReference: mapView.spatialReference
                            });
                            createLabel(offset, `Total: ${formatDistance(total, unit)}`, 'total-label');
                        }
                    };

                    const clearLabels = () => {
                        const labels = mapView.graphics.filter((g: any) =>
                            ['segment-label', 'total-label'].includes(g.attributes?.type)
                        );
                        mapView.graphics.removeMany(labels.toArray());
                    };

                    const watchHandles: __esri.WatchHandle[] = [];

                    watchHandles.push(distanceMeasurement2D.viewModel.watch('measurement', (m: any) => {
                        if (!m?.geometry) return;
                        clearLabels();
                        drawLabels(m.geometry, distanceMeasurement2D.unit);
                    }));

                    watchHandles.push(distanceMeasurement2D.watch('unit', (newUnit: string) => {
                        if (!validUnits.includes(newUnit)) {
                            // console.warn(`Invalid unit received: ${newUnit}. Reverting to primary unit: ${primaryUnit}`);
                            setTimeout(() => {
                                distanceMeasurement2D.unit = primaryUnit;
                            }, 50);
                            return;
                        }
                        const m = distanceMeasurement2D.viewModel.measurement;
                        if (!m?.geometry) return;
                        clearLabels();
                        // Handle async drawLabels function
                        drawLabels(m.geometry, newUnit);
                    }));

                    watchHandles.push(distanceMeasurement2D.viewModel.watch('state', (s: string) => {
                        if (s === 'ready') {
                            clearLabels();
                        } else if (s === 'measured') {
                            // JSAPI 5.x: geometry may only be available on state='measured'
                            // (during 'measuring' state, m.geometry can be null)
                            const m = distanceMeasurement2D.viewModel.measurement as any;
                            if (!m) return;
                            clearLabels();
                            if (m.geometry) {
                                drawLabels(m.geometry, distanceMeasurement2D.unit);
                            } else if (m.length > 0) {
                                // Final fallback: show total from m.length at view center
                                try {
                                    createLabel(
                                        mapView.center,
                                        `Total: ${formatDistance(m.length, distanceMeasurement2D.unit)}`,
                                        'total-label'
                                    );
                                } catch (_) { /* silent */ }
                            }
                        }
                    }));

                    const cleanup = () => {
                        clearLabels();
                        cancelLabelSuppression();
                        if ((distanceMeasurement2D as any).__disconnectObserver) {
                            (distanceMeasurement2D as any).__disconnectObserver();
                        }
                        watchHandles.forEach(h => h.remove());
                        mapView.ui.remove(distanceMeasurement2D);
                        distanceMeasurement2D.destroy();
                        setState(prev => ({ ...prev, isMeasuring: false, measurementWidget: null }));
                    };

                    const handleKey = (e: KeyboardEvent) => {
                        if (e.key === 'Escape') {
                            cleanup();
                            document.removeEventListener('keydown', handleKey);
                        }
                    };
                    document.addEventListener('keydown', handleKey);

                    distanceMeasurement2D.when(() => {
                        const widget = distanceMeasurement2D.container;
                        if (!widget) return;

                        setTimeout(() => {
                            const container = document.createElement('div');
                            container.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:12px;padding:0 12px 12px;';

                            const closeBtn = document.createElement('button');
                            closeBtn.textContent = 'Close';
                            closeBtn.style.cssText = `background:#6c757d;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500;font-family:${themeFont};`;
                            closeBtn.onmouseenter = () => closeBtn.style.background = '#545b62';
                            closeBtn.onmouseleave = () => closeBtn.style.background = '#6c757d';
                            closeBtn.onclick = (e) => {
                                e.preventDefault(); e.stopPropagation();
                                cleanup();
                                document.removeEventListener('keydown', handleKey);
                            };

                            container.appendChild(closeBtn);
                            widget.appendChild(container);

                            widget.style.cssText += `background:rgba(255,255,255,0.95);backdrop-filter:blur(10px);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);border:1px solid rgba(0,0,0,0.1);min-width:260px;font-family:${themeFont};`;
                        }, 300);
                    });

                    setState(prev => ({
                        ...prev,
                        isMeasuring: true,
                        measurementWidget: distanceMeasurement2D
                    }));
                } catch (err: any) {
                    // console.error(`Error starting measurement: ${err.message}`);
                }
            });
        } catch (err: any) {
            // console.error(`Error loading measurement tools: ${err.message}`);
        }
    }, [state.measurementWidget, props.config?.measurementSettings]);

    const startAreaMeasurement = React.useCallback(async () => {
        const mapView = mapViewRef.current;
        if (!mapView) return;

        try {
            if (state.areaMeasurementWidget) {
                if ((state.areaMeasurementWidget as any).__disconnectObserver) {
                    (state.areaMeasurementWidget as any).__disconnectObserver();
                }
                state.areaMeasurementWidget.destroy();
            }

            // Only remove AREA measurement labels, preserve distance labels
            const areaGraphics = mapView.graphics.filter((graphic: any) => {
                return graphic.attributes?.type === 'area-label' ||
                    graphic.attributes?.type === 'perimeter-label';
            });
            mapView.graphics.removeMany(areaGraphics.toArray());

            const measurementSettings = props.config?.measurementSettings || {
                defaultUnits: 'feet',
                unitDisplay: 'single'
            };

            // Snapshot layers BEFORE widget creation
            const labelSuppressor = createLabelSuppressor(mapView);
            labelSuppressor.snapshotLayers();

            (window as any).require([
                'esri/widgets/AreaMeasurement2D',
                'esri/Graphic',
                'esri/symbols/TextSymbol',
                'esri/geometry/geometryEngine',
                'esri/geometry/Point'
            ], (AreaMeasurement2D: any, Graphic: any, TextSymbol: any, geometryEngine: any, Point: any) => {
                try {
                    const validAreaUnits = ['square-feet', 'square-yards', 'square-miles', 'square-meters', 'square-kilometers', 'acres'];
                    const areaMeasurement2D = new AreaMeasurement2D({
                        view: mapView,
                        unitOptions: validAreaUnits as any
                    });
                    const measurement = areaMeasurement2D;

                    // Suppress ESRI's built-in on-map text labels
                    const cancelLabelSuppression = labelSuppressor.startSuppression();

                    let primaryUnit: string;
                    let secondaryUnit: string | null = null;

                    switch (measurementSettings.defaultUnits) {
                        case 'feet': primaryUnit = 'square-feet'; break;
                        case 'meters': primaryUnit = 'square-meters'; break;
                        case 'miles': primaryUnit = 'square-miles'; break;
                        case 'kilometers': primaryUnit = 'square-kilometers'; break;
                        case 'yards': primaryUnit = 'square-yards'; break;
                        default: primaryUnit = 'square-feet';
                    }

                    if (measurementSettings.unitDisplay === 'both') {
                        switch (measurementSettings.defaultUnits) {
                            case 'feet': secondaryUnit = 'square-meters'; break;
                            case 'meters': secondaryUnit = 'square-feet'; break;
                            case 'miles': secondaryUnit = 'square-kilometers'; break;
                            case 'kilometers': secondaryUnit = 'square-miles'; break;
                            case 'yards': secondaryUnit = 'square-meters'; break;
                        }
                    }

                    const initializeUnit = () => {
                        try {
                            measurement.unit = primaryUnit;
                            if (measurement.viewModel) {
                                measurement.viewModel.unit = primaryUnit;
                            }
                        } catch (e) {
                            // console.warn('Error setting initial unit:', e);
                        }
                    };

                    // --- Custom area label helpers ---
                    const unitDisplayNames: Record<string, string> = {
                        'square-feet': 'sq ft', 'square-meters': 'sq m',
                        'square-miles': 'sq mi', 'square-kilometers': 'sq km',
                        'square-yards': 'sq yd', 'acres': 'acres'
                    };

                    const areaConversions: Record<string, number> = {
                        'square-feet->square-meters': 0.092903,
                        'square-meters->square-feet': 10.7639,
                        'square-miles->square-kilometers': 2.58999,
                        'square-kilometers->square-miles': 0.386102,
                        'square-yards->square-meters': 0.836127,
                        'square-meters->square-yards': 1.19599
                    };

                    const formatArea = (area: number, unit: string): string => {
                        const displayUnit = unitDisplayNames[unit] || unit;
                        let formatted = `${area.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${displayUnit}`;
                        if (secondaryUnit && measurementSettings.unitDisplay === 'both') {
                            const key = `${unit}->${secondaryUnit}`;
                            const factor = areaConversions[key] ?? 1;
                            const converted = area * factor;
                            const secDisplay = unitDisplayNames[secondaryUnit] || secondaryUnit;
                            formatted += ` (${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${secDisplay})`;
                        }
                        return formatted;
                    };

                    const formatPerimeter = (perim: number, unit: string): string => {
                        const linearUnitMap: Record<string, string> = {
                            'square-feet': 'feet', 'square-meters': 'meters',
                            'square-miles': 'miles', 'square-kilometers': 'kilometers',
                            'square-yards': 'yards', 'acres': 'feet'
                        };
                        const linearUnit = linearUnitMap[unit] || 'feet';
                        return `Perimeter: ${perim.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${linearUnit}`;
                    };

                    const createAreaLabel = (pt: __esri.Point, text: string, attrType: string) => {
                        const label = new Graphic({
                            geometry: pt,
                            symbol: new TextSymbol({
                                text,
                                color: [255, 255, 255],
                                haloColor: [0, 0, 0],
                                haloSize: 2,
                                font: { size: 12, family: themeFont, weight: 'bold' },
                                verticalAlignment: 'middle',
                                horizontalAlignment: 'center'
                            }),
                            attributes: { type: attrType }
                        });
                        mapView.graphics.add(label);
                    };

                    const clearAreaLabels = () => {
                        const labels = mapView.graphics.filter((g: any) =>
                            ['area-label', 'perimeter-label'].includes(g.attributes?.type)
                        );
                        mapView.graphics.removeMany(labels.toArray());
                    };

                    const drawAreaLabels = (m: any, unit: string) => {
                        clearAreaLabels();
                        try {
                            const geometry = m?.geometry;
                            if (!geometry) return;

                            // Compute area directly from geometry using geometryEngine
                            // so we get the correct value in the requested unit.
                            // m.area is in the map's native SR units (sq meters for UTM)
                            // regardless of the widget's unit setting.
                            // Strategy: geodesicArea (needs WASM, works on Portal) →
                            //           planarArea (no WASM, any projected SR)
                            let area = 0;
                            try {
                                area = Math.abs(geometryEngine.geodesicArea(geometry, unit as any));
                            } catch (_) { /* WASM not available in local dev */ }
                            if (!area) {
                                try {
                                    area = Math.abs(geometryEngine.planarArea(geometry, unit as any));
                                } catch (_) { /* silent */ }
                            }
                            if (!area) return;

                            // Perimeter: use planarLength on the polygon's rings as a polyline
                            let perimeterLength = 0;
                            try {
                                const linearUnitMap: Record<string, string> = {
                                    'square-feet': 'feet', 'square-meters': 'meters',
                                    'square-miles': 'miles', 'square-kilometers': 'kilometers',
                                    'square-yards': 'yards', 'acres': 'feet'
                                };
                                const linearUnit = linearUnitMap[unit] || 'feet';
                                try {
                                    perimeterLength = geometryEngine.geodesicLength(geometry, linearUnit as any);
                                } catch (_) {
                                    perimeterLength = geometryEngine.planarLength(geometry, linearUnit as any);
                                }
                            } catch (_) { /* silent */ }

                            let centroid: __esri.Point | null = null;
                            if (geometry.centroid) {
                                centroid = geometry.centroid;
                            } else if (geometry.extent) {
                                centroid = geometry.extent.center;
                            }
                            if (!centroid) return;

                            createAreaLabel(centroid, `Area: ${formatArea(area, unit)}`, 'area-label');

                            if (perimeterLength > 0) {
                                const offset = new Point({
                                    x: centroid.x,
                                    y: centroid.y - (mapView.extent.height * 0.02),
                                    spatialReference: mapView.spatialReference
                                });
                                createAreaLabel(offset, formatPerimeter(perimeterLength, unit), 'perimeter-label');
                            }
                        } catch (e) {
                            // console.warn('Error drawing area labels:', e);
                        }
                    };
                    // --- End custom area label helpers ---

                    mapView.ui.add(measurement, 'top-right');
                    initializeUnit();

                    measurement.when(() => {
                        const disconnectObserver = hideUnwantedUnits(measurement, 'area');
                        // Store disconnect so cleanup can call it
                        (measurement as any).__disconnectObserver = disconnectObserver;
                        setTimeout(() => initializeUnit(), 100);
                        setTimeout(() => initializeUnit(), 300);
                        setTimeout(() => initializeUnit(), 500);

                        const widget = measurement.container;
                        if (!widget) return;

                        setTimeout(() => {
                            const container = document.createElement('div');
                            container.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:12px;padding:0 12px 12px;';

                            const closeBtn = document.createElement('button');
                            closeBtn.textContent = 'Close';
                            closeBtn.style.cssText = `background:#6c757d;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500;font-family:${themeFont};`;
                            closeBtn.onmouseenter = () => closeBtn.style.background = '#545b62';
                            closeBtn.onmouseleave = () => closeBtn.style.background = '#6c757d';
                            closeBtn.onclick = (e) => {
                                e.preventDefault(); e.stopPropagation();
                                cleanup();
                                document.removeEventListener('keydown', handleKeyPress);
                            };

                            container.appendChild(closeBtn);
                            widget.appendChild(container);

                            widget.style.cssText += `background:rgba(255,255,255,0.95);backdrop-filter:blur(10px);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);border:1px solid rgba(0,0,0,0.1);min-width:260px;font-family:${themeFont};`;
                        }, 300);
                    });

                    setTimeout(() => {
                        measurement.viewModel.start();
                        initializeUnit();
                    }, 200);

                    // Watch for measurement updates to draw custom labels
                    const areaWatchHandles: __esri.WatchHandle[] = [];

                    areaWatchHandles.push(measurement.viewModel.watch('measurement', (m: any) => {
                        if (!m) return;
                        drawAreaLabels(m, measurement.unit);
                    }));

                    measurement.watch('unit', (newUnit: string) => {
                        if (!validAreaUnits.includes(newUnit)) {
                            // console.warn(`Invalid area unit received: ${newUnit}. Reverting to primary unit: ${primaryUnit}`);
                            setTimeout(() => {
                                measurement.unit = primaryUnit;
                            }, 50);
                            return;
                        }
                        const m = measurement.viewModel.measurement;
                        if (m) drawAreaLabels(m, newUnit);
                    });

                    areaWatchHandles.push(measurement.viewModel.watch('state', (s: string) => {
                        if (s === 'ready') clearAreaLabels();
                    }));

                    setState(prevState => ({
                        ...prevState,
                        isMeasuringArea: true,
                        areaMeasurementWidget: measurement as any
                    }));

                    const cleanup = () => {
                        clearAreaLabels();
                        cancelLabelSuppression();
                        if ((measurement as any).__disconnectObserver) {
                            (measurement as any).__disconnectObserver();
                        }
                        areaWatchHandles.forEach(h => h.remove());
                        if (measurement) {
                            mapView.ui.remove(measurement);
                            measurement.destroy();
                        }
                        setState(prevState => ({
                            ...prevState,
                            isMeasuringArea: false,
                            areaMeasurementWidget: null
                        }));
                    };

                    const handleKeyPress = (event: KeyboardEvent) => {
                        if (event.key === 'Escape') {
                            cleanup();
                            document.removeEventListener('keydown', handleKeyPress);
                        }
                    };
                    document.addEventListener('keydown', handleKeyPress);

                } catch (error) {
                    // console.error(`Error starting area measurement: ${error.message}`);
                }
            });

        } catch (error) {
            // console.error(`Error loading area measurement tools: ${error.message}`);
        }
    }, [state.areaMeasurementWidget, props.config?.measurementSettings]);

    const queryFeatureLayer = React.useCallback(async (
        layer: FeatureLayerConfig,
        mapPoint: __esri.Point
    ): Promise<{ layerName: string; features: any[]; layerUrl: string }> => {
        try {
            const whatsHereSettings = props.config?.whatsHereSettings || {};

            // Use the original map point coordinate system for the query
            let queryPoint = mapPoint;

            // Only project if a specific target WKID is configured
            if (props.config?.reverseGeocodeWkid && props.config.reverseGeocodeWkid !== mapPoint.spatialReference?.wkid) {
                try {
                    queryPoint = await projectToSpatialReference(mapPoint, props.config.reverseGeocodeWkid);
                } catch (projectionError) {
                    // console.warn(`Projection failed, using original coordinates:`, projectionError);
                    queryPoint = mapPoint;
                }
            }

            const queryUrl = `${layer.url}/query`;

            // Create geometry object properly
            const geometryObj = {
                x: queryPoint.x,
                y: queryPoint.y,
                spatialReference: {
                    wkid: queryPoint.spatialReference?.wkid || 4326
                }
            };

            // Ensure proper spatial relationship values
            const defaultSpatialRel = whatsHereSettings.spatialRelationship || 'esriSpatialRelIntersects';

            // Validate and fix spatial relationship values
            const validSpatialRel = defaultSpatialRel.startsWith('esriSpatialRel')
                ? defaultSpatialRel
                : `esriSpatialRel${defaultSpatialRel.charAt(0).toUpperCase()}${defaultSpatialRel.slice(1)}`;

            const spatialRelationships = [
                validSpatialRel,
                'esriSpatialRelIntersects',
                'esriSpatialRelContains',
                'esriSpatialRelWithin'
            ];

            // Try without distance first, then with distance, then with simplified parameters
            const queryAttempts = [];

            // Attempt 1: Basic query
            queryAttempts.push({
                geometry: JSON.stringify(geometryObj),
                geometryType: 'esriGeometryPoint',
                spatialRel: spatialRelationships[0],
                outFields: (layer.fields && layer.fields.length > 0) ? layer.fields.join(',') : '*',
                // Always return geometry — needed for highlight + Zoom-to.
                // The whatsHereSettings.includeGeometry flag is now ignored
                // for these queries (it predates those features).
                returnGeometry: 'true',
                resultRecordCount: (whatsHereSettings.maxResults || 10).toString(),
                f: 'json'
            });

            // Attempt 2: With buffer if configured
            if (whatsHereSettings.searchRadius && whatsHereSettings.searchRadius > 0) {
                queryAttempts.push({
                    geometry: JSON.stringify(geometryObj),
                    geometryType: 'esriGeometryPoint',
                    spatialRel: spatialRelationships[0],
                    outFields: (layer.fields && layer.fields.length > 0) ? layer.fields.join(',') : '*',
                    returnGeometry: 'true',
                    resultRecordCount: (whatsHereSettings.maxResults || 10).toString(),
                    distance: whatsHereSettings.searchRadius.toString(),
                    units: 'esriSRUnit_Meter',
                    f: 'json'
                });
            }

            // Attempt 3: Simplified query with just coordinates
            queryAttempts.push({
                geometry: `${queryPoint.x},${queryPoint.y}`,
                geometryType: 'esriGeometryPoint',
                spatialRel: 'esriSpatialRelIntersects',
                outFields: '*',
                returnGeometry: 'false',
                f: 'json'
            });

            // Attempt 4: Using envelope instead of point
            const tolerance = 1; // 1 meter tolerance
            const envelope = {
                xmin: queryPoint.x - tolerance,
                ymin: queryPoint.y - tolerance,
                xmax: queryPoint.x + tolerance,
                ymax: queryPoint.y + tolerance,
                spatialReference: { wkid: queryPoint.spatialReference?.wkid || 4326 }
            };

            queryAttempts.push({
                geometry: JSON.stringify(envelope),
                geometryType: 'esriGeometryEnvelope',
                spatialRel: 'esriSpatialRelIntersects',
                outFields: (layer.fields && layer.fields.length > 0) ? layer.fields.join(',') : '*',
                returnGeometry: 'false',
                f: 'json'
            });

            let lastError = null;

            for (let attemptIndex = 0; attemptIndex < queryAttempts.length; attemptIndex++) {
                const queryParams = queryAttempts[attemptIndex];
                const params = new URLSearchParams(queryParams);
                // Add ordering if specified
                if (whatsHereSettings.orderBy) {
                    params.append('orderByFields', whatsHereSettings.orderBy);
                }
                try {
                    const response = await fetch(`${queryUrl}?${params.toString()}`, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/x-www-form-urlencoded'
                        }
                    });
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    const json = await response.json();
                    if (json.error) {
                        lastError = new Error(`[${json.error.code || 'Unknown'}] ${json.error.message || `Query failed for layer ${layer.name}`}`);
                        continue; // Try next attempt
                    }
                    return {
                        layerName: layer.name,
                        features: (json.features || []).map((f: any) => {
                            // REST responses give plain JSON for geometry —
                            // hydrate to a real Esri Geometry instance so
                            // highlight + zoom-to can use it directly. The
                            // top-level json.spatialReference is the shared
                            // SR for the response when individual features
                            // omit it (very common).
                            let geom: any = null;
                            if (f?.geometry) {
                                try {
                                    const withSr = (f.geometry.spatialReference || json.spatialReference)
                                        ? { ...f.geometry, spatialReference: f.geometry.spatialReference || json.spatialReference }
                                        : f.geometry;
                                    geom = (geometryJsonUtils as any).fromJSON(withSr);
                                } catch (_) { geom = null; }
                            }
                            return {
                                attributes: f.attributes || {},
                                geometry: geom
                            };
                        }),
                        layerUrl: layer.url
                    };
                } catch (error) {
                    lastError = error;
                }
            }

            // If we get here, all attempts failed
            throw lastError || new Error(`All query attempts failed for layer ${layer.name}`);

        } catch (error) {
            // console.error(`Error querying layer ${layer.name}:`, error);
            // Return empty result instead of throwing to prevent breaking other layers
            return { layerName: layer.name, features: [], layerUrl: layer.url };
        }
    }, [projectToSpatialReference, props.config]);

    const generatePopupContent = React.useCallback((results: Array<{ layerName: string; features: any[]; layerUrl: string }>): string => {
        const uiSettings = props.config?.uiSettings || {};
        const showLayerNames = uiSettings.showLayerNames !== false;
        const groupByLayer = uiSettings.groupByLayer !== false;
        const showFieldAliases = uiSettings.showFieldAliases !== false;

        let content = '';

        results.forEach(({ layerName, features, layerUrl }, layerIndex) => {
            if (features.length === 0) return;

            if (showLayerNames && groupByLayer) {
                content += `
                    <div style="
                        font-weight: 600; 
                        color: #323232; 
                        margin: ${layerIndex > 0 ? '20px' : '0px'} 0 12px 0; 
                        padding-bottom: 6px;
                        border-bottom: 2px solid #0079c1;
                        font-size: 15px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    ">
                        ${layerName}
                    </div>
                `;
            }

            features.forEach((feature, featureIndex) => {
                const attributes = feature.attributes;

                if (!groupByLayer && showLayerNames) {
                    content += `
                        <div style="
                            display: flex;
                            align-items: flex-start;
                            margin-bottom: 8px;
                            padding: 6px 0;
                            border-bottom: 1px solid #e0e0e0;
                        ">
                            <div style="
                                font-weight: 600;
                                color: #0079c1;
                                white-space: nowrap;
                                flex-shrink: 0;
                                min-width: 60px;
                                font-size: 13px;
                            ">
                                Layer:
                            </div>
                            <div style="
                                color: #323232;
                                word-wrap: break-word;
                                flex: 1;
                                margin-left: 8px;
                                font-size: 13px;
                            ">
                                ${layerName}
                            </div>
                        </div>
                    `;
                }

                const filteredAttributes = Object.entries(attributes).filter(([fieldName, value]) => {
                    if (['OBJECTID', 'FID', 'SHAPE', 'Shape', 'GlobalID', 'GLOBALID'].includes(fieldName)) {
                        return false;
                    }
                    return value !== null && value !== undefined && value !== '';
                });

                filteredAttributes.forEach(([fieldName, value]) => {
                    const displayName = getFieldDisplayName(fieldName, layerUrl, showFieldAliases);
                    const formattedValue = formatFieldValue(value, fieldName);

                    content += `
                        <div style="
                            display: flex;
                            align-items: flex-start;
                            margin-bottom: 6px;
                            padding: 2px 0;
                            min-height: 20px;
                        ">
                            <div style="
                                font-weight: 600;
                                color: #0079c1;
                                white-space: nowrap;
                                flex-shrink: 0;
                                min-width: 120px;
                                font-size: 13px;
                                line-height: 1.4;
                            ">
                                ${displayName}:
                            </div>
                            <div style="
                                color: #323232;
                                word-wrap: break-word;
                                flex: 1;
                                margin-left: 8px;
                                font-size: 13px;
                                line-height: 1.4;
                            ">
                                ${formattedValue}
                            </div>
                        </div>
                    `;
                });

                if (featureIndex < features.length - 1) {
                    content += '<div style="margin: 16px 0; border-bottom: 1px solid #e8e8e8;"></div>';
                }
            });
        });

        return content || '<div style="color: #6e6e6e; font-style: italic; text-align: center; padding: 20px;">No features found at this location.</div>';
    }, [props.config?.uiSettings, state.layerFieldMetadata]);

    const getFieldDisplayName = React.useCallback((fieldName: string, layerUrl: string, useAliases: boolean): string => {
        if (!useAliases) return fieldName;

        const fieldMetadata = state.layerFieldMetadata[layerUrl]?.[fieldName];
        if (fieldMetadata?.alias && fieldMetadata.alias !== fieldName) {
            return fieldMetadata.alias;
        }

        const layer = props.config?.featureLayers?.find(l => l.url === layerUrl);
        if (layer?.aliasFields?.[fieldName]) {
            return layer.aliasFields[fieldName];
        }

        const commonAliases: Record<string, string> = {
            'OBJECTID': 'Object ID',
            'ObjectID': 'Object ID',
            'FID': 'Feature ID',
            'SHAPE': 'Geometry',
            'Shape': 'Geometry',
            'SHAPE_Area': 'Area',
            'SHAPE_Length': 'Length',
            'Shape_Area': 'Area',
            'Shape_Length': 'Length',
            'CREATED_DATE': 'Created Date',
            'LAST_EDITED_DATE': 'Last Modified',
            'CreationDate': 'Created Date',
            'EditDate': 'Last Modified',
            'GlobalID': 'Global ID',
            'GLOBALID': 'Global ID',
            'NAME': 'Name',
            'Name': 'Name',
            'TYPE': 'Type',
            'Type': 'Type',
            'STATUS': 'Status',
            'Status': 'Status',
            'DESCRIPTION': 'Description',
            'Description': 'Description',
            'ADDRESS': 'Address',
            'Address': 'Address',
            'CITY': 'City',
            'City': 'City',
            'STATE': 'State',
            'State': 'State',
            'ZIP': 'ZIP Code',
            'ZIPCODE': 'ZIP Code',
            'ZIP_CODE': 'ZIP Code',
            'PHONE': 'Phone',
            'Phone': 'Phone',
            'EMAIL': 'Email',
            'Email': 'Email',
            'URL': 'Website',
            'WEBSITE': 'Website',
            'Website': 'Website',
            'TRACTCE20': 'Census Tract',
            'NAMELSAD20': 'Census Tract Name',
            'TOTALPOP': 'Total Population',
            'GEOID20': 'Geographic ID'
        };

        if (commonAliases[fieldName]) {
            return commonAliases[fieldName];
        }

        const lowerFieldName = fieldName.toLowerCase();
        const matchingKey = Object.keys(commonAliases).find(key => key.toLowerCase() === lowerFieldName);
        if (matchingKey) {
            return commonAliases[matchingKey];
        }

        return fieldName
            .replace(/_/g, ' ')
            .replace(/([A-Z])/g, ' $1')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, l => l.toUpperCase());
    }, [props.config?.featureLayers, state.layerFieldMetadata]);

    const formatFieldValue = React.useCallback((value: any, fieldName: string): string => {
        if (value === null || value === undefined) return '';

        if (fieldName.toLowerCase().includes('date') || fieldName.toLowerCase().includes('time')) {
            try {
                const date = new Date(value);
                if (!isNaN(date.getTime())) {
                    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                }
            } catch (e) {
                // Fall through to default formatting
            }
        }

        if (typeof value === 'number') {
            if (fieldName.toLowerCase().includes('area')) {
                return value.toLocaleString() + ' sq units';
            } else if (fieldName.toLowerCase().includes('length') || fieldName.toLowerCase().includes('distance')) {
                return value.toLocaleString() + ' units';
            } else if (value % 1 !== 0) {
                return value.toFixed(2);
            } else {
                return value.toLocaleString();
            }
        }

        return String(value);
    }, []);

    // ─── What's Here: auto-discovery of queryable map layers ────────────────
    // Walks the live map and returns every queryable feature-like layer
    // (FeatureLayer, GeoJSONLayer, CSVLayer, OGCFeatureLayer, WFSLayer, and
    // every Sublayer inside a MapImageLayer / TileLayer) — including those
    // nested arbitrarily deep inside GroupLayers and map service group
    // sublayers. Visibility and scale dependencies are honored so we don't
    // query layers the user has toggled off or that aren't drawn at the
    // current zoom. This is the bedrock that lets "What's Here" work without
    // any per-layer configuration in widget settings.
    const collectQueryableLayersFromMap = React.useCallback((): Array<{
        name: string;
        mapLayer: any;
        layerUrl: string;
        popupEnabled: boolean;
    }> => {
        const mv = mapViewRef.current;
        if (!mv?.map) return [];

        const currentScale = mv.scale || 0;
        const entries: Array<{ name: string; mapLayer: any; layerUrl: string; popupEnabled: boolean }> = [];
        const seenKeys = new Set<string>();

        // The Layer Selection setting drives which layers are *eligible* —
        // and on top of that, a layer must also be currently turned on in
        // the map (visible up the entire parent chain) and within its
        // scale-dependency window. "What's Here" reflects what the user can
        // actually see at this moment, so toggling a layer off in the
        // legend or zooming past its scale range hides it from results.
        const ROOT_CLASSES = new Set([
            'esri.Map',
            'esri.WebMap',
            'esri.WebScene',
            'esri.Basemap'
        ]);

        const effectivelyVisible = (lyr: any): boolean => {
            // A layer is effectively visible only if its own `visible` flag
            // AND every ancestor (parent sublayer, GroupLayer, MapImageLayer)
            // up the chain has visible !== false. The walk terminates at the
            // map/basemap container.
            let cur = lyr;
            let hops = 0;
            while (cur && hops < 50) {
                if (cur.visible === false) return false;
                const next = cur.parent;
                if (!next || next === cur) break;
                const cls = String((next as any)?.declaredClass || '');
                // Exact-equality only — previously `cls.includes('Map')` also
                // matched MapImageLayer / MapNotesLayer and terminated the
                // walk early, letting hidden parents slip through.
                if (ROOT_CLASSES.has(cls)) break;
                cur = next;
                hops++;
            }
            return true;
        };

        const inScaleRange = (lyr: any): boolean => {
            // Esri scale convention: minScale is the more-zoomed-OUT limit
            // (numerically larger); maxScale is the more-zoomed-IN limit
            // (numerically smaller). 0 means unconstrained on that end.
            // currentScale === 0 falls through and is treated as in-range.
            if (!currentScale) return true;
            const min = Number(lyr?.minScale ?? 0);
            const max = Number(lyr?.maxScale ?? 0);
            if (min > 0 && currentScale > min) return false;
            if (max > 0 && currentScale < max) return false;
            return true;
        };

        const tryAdd = (lyr: any, fallbackName: string) => {
            if (!lyr || typeof lyr.queryFeatures !== 'function') return;

            // Only query layers the user has currently turned on in the map.
            // Both helpers are deliberately permissive — undefined / null /
            // missing visibility or scale fields are treated as "in range"
            // rather than excluded, because a brand-new layer can briefly
            // have those fields unset between when it's added and when
            // Esri's reactive system finishes initializing it.
            if (!effectivelyVisible(lyr)) return;
            if (!inScaleRange(lyr)) return;

            // Developer-controlled layer selection. If the dev configured an
            // explicit selection list in widget settings, only layers whose
            // selection key — OR the key of any ancestor in the layer tree —
            // appears in that list are eligible.
            //
            // Fast path: if any ancestor's key (or, for sublayers, the owning
            // MapImageLayer's key) is in `trustedGroupKeys`, the layer is
            // included immediately regardless of selectedKeys. This is the
            // "trust this group" feature — it makes new layers added to the
            // service / group at runtime appear automatically without any
            // settings change.
            //
            // Otherwise, the match below is intentionally permissive: it
            // tries the computed selection key, the raw layer id, and the
            // layer's title against the allowed set. Any match counts as a
            // hit. This rescues stale configs from before this code shipped
            // (which may have stored just leaf ids) AND configs that store
            // group ancestors (which catch newly-added group children).
            //
            // Default (no selection configured, mode === 'all', or an
            // empty selectedKeys list) = include every queryable layer.
            const sel = props.config?.whatsHereLayerSelection;
            const allowedKeys = Array.isArray(sel?.selectedKeys) ? sel!.selectedKeys! : [];
            const trustedKeys = Array.isArray((sel as any)?.trustedGroupKeys) ? (sel as any).trustedGroupKeys as string[] : [];
            const selectionInForce = !!sel && sel.mode === 'selected' && allowedKeys.length > 0;

            // Trust fast-path runs even when selectionInForce is false, on the
            // off-chance someone has trusted groups but mode === 'all'. In
            // that case the layer would have been included anyway, so this
            // is a no-op.
            const trustedSet = new Set(trustedKeys);
            const isInTrustedSubtree = (start: any): boolean => {
                if (trustedSet.size === 0) return false;
                let cur: any = start;
                let hops = 0;
                while (cur && hops < 30) {
                    // Check this node's selection key, its raw id, and title
                    // against the trusted set — any one of them counts.
                    const k = computeLayerSelectionKey(cur);
                    if (k && trustedSet.has(k)) return true;
                    const idStr = cur.id != null ? String(cur.id) : '';
                    if (idStr && trustedSet.has(idStr)) return true;
                    const title = cur.title || '';
                    if (title && trustedSet.has(title)) return true;
                    const next = cur.parent;
                    if (!next || next === cur) break;
                    const cls = String((next as any)?.declaredClass || '');
                    if (ROOT_CLASSES.has(cls)) break;
                    cur = next;
                    hops++;
                }
                return false;
            };

            if (selectionInForce) {
                // If the layer (or any ancestor) is trusted, skip all other
                // selection checks and include immediately.
                if (isInTrustedSubtree(lyr)) {
                    // matched — fall through to URL dedupe below
                } else {
                    const allowedSet = new Set(allowedKeys);

                    // Extract the set of MapImageLayer / TileLayer service ids
                    // referenced by composite "<serviceId>::sub::<subId>" keys.
                    // If a sublayer's owning service id matches one of these,
                    // we accept it regardless of which specific sub-id pairs
                    // are in the saved selection. This is what lets sublayers
                    // added to a map service later be auto-included.
                    const allowedServiceIds = new Set<string>();
                    for (const k of allowedKeys) {
                        const idx = k.indexOf('::sub::');
                        if (idx > 0) allowedServiceIds.add(k.substring(0, idx));
                    }

                    const matchesAllowed = (node: any): boolean => {
                        if (!node) return false;
                        const k = computeLayerSelectionKey(node);
                        if (k && allowedSet.has(k)) return true;
                        const idStr = node.id != null ? String(node.id) : '';
                        if (idStr && allowedSet.has(idStr)) return true;
                        const title = node.title || '';
                        if (title && allowedSet.has(title)) return true;
                        return false;
                    };

                    // First-pass match: walk own + ancestor keys.
                    let matched = false;
                    let cur: any = lyr;
                    let hops = 0;
                    while (cur && hops < 30) {
                        if (matchesAllowed(cur)) { matched = true; break; }
                        const next = cur.parent;
                        if (!next || next === cur) break;
                        const cls = String((next as any)?.declaredClass || '');
                        if (ROOT_CLASSES.has(cls)) break;
                        cur = next;
                        hops++;
                    }

                    // Service-prefix fallback: if this layer is a sublayer of a
                    // MapImageLayer / TileLayer and that service's id appears as
                    // the prefix of any "<serviceId>::sub::<subId>" key in the
                    // saved selection, treat it as matched. This catches sublayers
                    // added to a service after the selection was saved.
                    if (!matched && allowedServiceIds.size > 0) {
                        let owner: any = lyr.parent;
                        let oHops = 0;
                        while (owner && oHops < 30) {
                            const oCls = String(owner?.declaredClass || '');
                            const oType = String(owner?.type || '');
                            const isService =
                                oType === 'map-image' || oType === 'tile' || oType === 'imagery-tile' ||
                                oCls.indexOf('MapImageLayer') >= 0 || oCls.indexOf('TileLayer') >= 0;
                            if (isService) {
                                const ownerIdStr = owner.id != null ? String(owner.id) : '';
                                if (ownerIdStr && allowedServiceIds.has(ownerIdStr)) {
                                    matched = true;
                                }
                                break;
                            }
                            const nxt = owner.parent;
                            if (!nxt || nxt === owner) break;
                            owner = nxt;
                            oHops++;
                        }
                    }

                    if (!matched) return;
                }
            }

            // Derive a URL (used both for dedupe and for downstream metadata
            // lookups). FeatureLayers expose `url` directly; Sublayers of a
            // MapImageLayer derive their URL from parent.url + id.
            let url: string = lyr.url || '';
            if (!url && lyr.id !== undefined && lyr.parent?.url) {
                url = `${String(lyr.parent.url).replace(/\/+$/, '')}/${lyr.id}`;
            }

            const key = (url || `${lyr.declaredClass || 'layer'}::${lyr.uid || lyr.id || fallbackName}`).toLowerCase();
            if (seenKeys.has(key)) return;
            seenKeys.add(key);

            entries.push({
                name: lyr.title || fallbackName || 'Layer',
                mapLayer: lyr,
                layerUrl: url,
                popupEnabled: lyr.popupEnabled !== false
            });
        };

        // Recursive walk: handles GroupLayers (via `.layers`), MapImageLayer
        // sublayers (via `.sublayers` / `.allSublayers`), and nested group
        // sublayers inside a map service.
        const visit = (lyr: any, depth: number) => {
            if (!lyr || depth > 20) return;

            // Feature-like layers: query them directly.
            tryAdd(lyr, lyr.title || `Layer ${lyr.id ?? ''}`);

            // Descend into GroupLayer children. Try every collection name
            // and access mode — `.items` works for already-materialized
            // Collections but is undefined on JSAPI Collections that haven't
            // been touched yet; `.toArray()` always returns the current
            // contents. Falling back across both shapes catches every case.
            const childCollections = [
                lyr?.layers?.toArray?.(),
                lyr?.layers?.items,
                lyr?.sublayers?.toArray?.(),
                lyr?.sublayers?.items
            ];
            for (const col of childCollections) {
                if (Array.isArray(col)) {
                    for (const child of col) visit(child, depth + 1);
                }
            }

            // Descend into map service sublayers (MapImageLayer, TileLayer,
            // ImageryLayer). Prefer `allSublayers` when available — it
            // pre-flattens any group sublayers within the service. We also
            // call `.toArray()` because some Esri Collections lazy-build
            // `.items` and return `undefined` before first access.
            const subs = lyr?.allSublayers?.toArray?.()
                || lyr?.allSublayers?.items
                || lyr?.sublayers?.toArray?.()
                || lyr?.sublayers?.items
                || [];
            if (Array.isArray(subs)) {
                for (const sub of subs) {
                    // Skip group sublayers — they aren't queryable themselves,
                    // but their children are reachable through this same loop
                    // because allSublayers is flat.
                    tryAdd(sub, sub.title || `Sublayer ${sub.id ?? ''}`);
                }
            }
        };

        // Top-level walk. We feed BOTH the flat `allLayers` collection AND
        // the raw `layers` collection into the visitor. `allLayers` is
        // supposed to be reactive and pre-flattened across all nested
        // GroupLayers, but in practice it occasionally lags behind layers
        // added via direct `groupLayer.layers.add(...)` calls. Visiting both
        // and relying on `seenKeys` dedupe inside tryAdd means a layer
        // that's missing from one collection but present in the other still
        // gets caught.
        const allLayersCol = (mv.map as any).allLayers?.items
            || (mv.map as any).allLayers?.toArray?.()
            || [];
        const topLayersCol = (mv.map as any).layers?.items
            || (mv.map as any).layers?.toArray?.()
            || [];

        for (const layer of allLayersCol) visit(layer, 0);
        for (const layer of topLayersCol) visit(layer, 0);

        return entries;
    }, []);

    // Query a single discovered layer entry at the click point using the
    // layer's native queryFeatures() — works uniformly across FeatureLayer,
    // MapImageLayer sublayer, GeoJSONLayer, CSVLayer, WFSLayer, etc., and
    // automatically reprojects geometry as needed.
    const queryLayerEntryAtPoint = React.useCallback(async (
        entry: { name: string; mapLayer: any; layerUrl: string; popupEnabled: boolean },
        mapPoint: __esri.Point
    ): Promise<{ layerName: string; features: any[]; layerUrl: string; popupEnabled: boolean; mapLayer: any }> => {
        const whatsHereSettings = props.config?.whatsHereSettings || {};
        const maxResults = whatsHereSettings.maxResults || 10;

        const result = {
            layerName: entry.name,
            features: [] as any[],
            layerUrl: entry.layerUrl,
            popupEnabled: entry.popupEnabled,
            mapLayer: entry.mapLayer
        };

        try {
            // Some layers need to be "loaded" before queryFeatures will work
            // (especially sublayers fetched on-demand from a MapServer).
            if (typeof entry.mapLayer.load === 'function' && entry.mapLayer.loadStatus !== 'loaded') {
                try { await entry.mapLayer.load(); } catch (_) { /* keep going */ }
            }

            const q: any = {
                geometry: mapPoint,
                spatialRelationship: 'intersects',
                outFields: ['*'],
                // Always return geometry: needed for the in-popup highlight
                // and the Zoom-to button. Cost is tiny on a per-feature basis
                // and well worth the UX. The legacy includeGeometry flag in
                // whatsHereSettings is ignored here for that reason.
                returnGeometry: true,
                num: maxResults
            };
            // Determine click tolerance. Configured searchRadius always wins.
            // Otherwise: zero for polygons (a click inside intersects natively),
            // and a screen-pixel-relative buffer for points and polylines —
            // those have effectively no clickable area at typical zoom levels
            // and are otherwise nearly impossible to hit precisely.
            //
            // The buffer is computed from the view's current resolution
            // (map units per pixel) so a missed click within ~12px of a point
            // or line still selects it, regardless of zoom level. A small
            // fixed fallback in meters covers the edge case where the view's
            // resolution isn't yet available.
            const POINT_LINE_PIXEL_TOLERANCE = 12;
            const FALLBACK_TOLERANCE_METERS = 10;
            const layerGeomType = String(entry.mapLayer?.geometryType || '').toLowerCase();
            const isPointLayer = layerGeomType.indexOf('point') >= 0;       // 'point', 'multipoint', 'esriGeometryPoint', etc.
            const isLineLayer = layerGeomType.indexOf('line') >= 0;         // 'polyline', 'esriGeometryPolyline'
            const needsDefaultTolerance = isPointLayer || isLineLayer;

            if (whatsHereSettings.searchRadius && whatsHereSettings.searchRadius > 0) {
                q.distance = whatsHereSettings.searchRadius;
                q.units = 'meters';
            } else if (needsDefaultTolerance) {
                const mv = mapViewRef.current;
                const resolution = mv?.resolution || 0; // map units / pixel
                // For Web Mercator (the overwhelming default) resolution is
                // already in meters; for other spatial references Esri's
                // query API auto-converts when we declare units='meters'.
                const dynamicMeters = resolution > 0
                    ? resolution * POINT_LINE_PIXEL_TOLERANCE
                    : FALLBACK_TOLERANCE_METERS;
                q.distance = dynamicMeters;
                q.units = 'meters';
            }
            if (whatsHereSettings.orderBy) {
                q.orderByFields = [whatsHereSettings.orderBy];
            }

            const fs = await entry.mapLayer.queryFeatures(q);
            result.features = (fs?.features || []).map((g: any) => ({
                // Normalize to a plain object so downstream code that does
                // Object.entries(attributes) works regardless of whether the
                // layer returned esri/Graphic instances or POJOs. We DO keep
                // the geometry reference — Graphic.geometry is already a real
                // Esri Geometry instance, so highlighting and zoom-to can
                // pass it straight to new Graphic({geometry, symbol}) and
                // view.goTo(geometry).
                attributes: g?.attributes || {},
                geometry: g?.geometry || null
            }));
        } catch (_e) {
            // Some sublayers (raster, etc.) advertise queryFeatures but fail
            // when actually called — swallow and leave features = [].
        }

        return result;
    }, [props.config?.whatsHereSettings]);

    // ─── What's Here: master/detail popup helpers ───────────────────────────
    // The original implementation rendered every queried feature inline in a
    // single popup. This enhancement instead shows a clickable list of features
    // grouped by layer; clicking a feature opens a detail view (only if the
    // underlying map layer has popups enabled) with a "Back" button that
    // returns to the master list.

    // Escape values for safe interpolation into popup HTML.
    const escapePopupHtml = React.useCallback((s: any): string => {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }, []);

    // Find the live map layer that corresponds to a configured FeatureLayerConfig
    // URL. Handles both standalone FeatureLayers and sublayers inside a
    // MapImageLayer. Returns null when no match is found.
    const findMapLayerByUrl = React.useCallback((layerUrl: string): any | null => {
        const mv = mapViewRef.current;
        if (!mv?.map || !layerUrl) return null;
        const normalize = (u: string) => (u || '').replace(/\/+$/, '').toLowerCase();
        const target = normalize(layerUrl);
        const all = (mv.map as any).allLayers?.items || [];

        for (const layer of all) {
            if (layer?.url && normalize(layer.url) === target) return layer;
            // MapImageLayer / TiledLayer with sublayers: each sublayer is a service layer (.../MapServer/<id>)
            const sublayers = (layer as any)?.sublayers?.items || (layer as any)?.allSublayers?.items || [];
            for (const sub of sublayers) {
                const subUrl = sub?.url ? sub.url : (layer?.url && sub?.id !== undefined ? `${layer.url.replace(/\/+$/, '')}/${sub.id}` : null);
                if (subUrl && normalize(subUrl) === target) return sub;
            }
        }
        return null;
    }, []);

    // Whether the live map layer corresponding to a configured URL has popups
    // enabled. When the layer cannot be found (e.g. it's not in the current
    // webmap) we default to true since the layer was deliberately configured
    // for "What's Here" — the user clearly wants its features inspectable.
    const isPopupEnabledForLayerUrl = React.useCallback((layerUrl: string): boolean => {
        const mapLayer = findMapLayerByUrl(layerUrl);
        if (!mapLayer) return true;
        // popupEnabled is the canonical flag. Some layer types (e.g. sublayers)
        // use the same name; both honored.
        if (mapLayer.popupEnabled === false) return false;
        return true;
    }, [findMapLayerByUrl]);

    // Pick a short, human-readable label for a feature row in the master list.
    // Strategy: prefer the layer's popupTemplate.title (with {field} substitution),
    // then well-known display fields, then the first non-system string value,
    // then the OBJECTID.
    const getFeatureRowLabel = React.useCallback((feature: any, layerUrl: string, mapLayerOverride?: any): string => {
        const attrs = feature?.attributes || {};
        const mapLayer = mapLayerOverride || findMapLayerByUrl(layerUrl);

        // popupTemplate.title with {field} substitution
        const tpl = mapLayer?.popupTemplate?.title;
        if (tpl && typeof tpl === 'string' && tpl.indexOf('{') !== -1) {
            const filled = tpl.replace(/\{([^}]+)\}/g, (_match: string, name: string) => {
                const key = name.trim();
                const v = attrs[key];
                return (v !== undefined && v !== null && v !== '') ? String(v) : '';
            }).trim();
            // Reject if substitution left nothing meaningful behind (e.g. just punctuation)
            if (filled && /[A-Za-z0-9]/.test(filled)) return filled;
        }

        // Preferred display field names
        const preferredKeys = [
            'NAME', 'Name', 'name',
            'FULLNAME', 'FullName', 'Fullname',
            'LABEL', 'Label',
            'TITLE', 'Title',
            'PARCEL', 'PARCEL_NUM', 'PARCEL_NO', 'PARCELNO', 'PARCEL_ID', 'PARCELID',
            'ADDRESS', 'Address', 'FULL_ADDRESS', 'SITE_ADDRESS',
            'BUSINESS_NAME', 'OWNER', 'OWNER_NAME',
            'DESCRIPTION', 'Description', 'DESC',
            'STREET', 'STREET_NAME'
        ];
        for (const k of preferredKeys) {
            const v = attrs[k];
            if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
        }

        // First non-system string value
        const systemFields = new Set(['OBJECTID', 'ObjectID', 'FID', 'SHAPE', 'Shape', 'GlobalID', 'GLOBALID']);
        for (const [k, v] of Object.entries(attrs)) {
            if (systemFields.has(k)) continue;
            if (typeof v === 'string' && v.trim() !== '') return v;
            if (typeof v === 'number' && !isNaN(v)) return String(v);
        }

        const oid = attrs.OBJECTID ?? attrs.ObjectID ?? attrs.FID;
        return oid !== undefined ? `Feature #${oid}` : 'Feature';
    }, [findMapLayerByUrl]);

    // Build the master ("What's Here?" landing) popup HTML: address banner plus
    // a clickable list grouped by layer. Features on layers with popupEnabled === false
    // render as non-clickable rows with a small "popups disabled" hint.
    const generateMasterWhatsHereContent = React.useCallback((
        addressText: string,
        results: Array<{ layerName: string; features: any[]; layerUrl: string; popupEnabled: boolean; mapLayer?: any }>
    ): string => {
        const uiSettings = props.config?.uiSettings || {};
        const showLayerNames = uiSettings.showLayerNames !== false;

        let content = `<div style="font-family: ${themeFont}; color: #323232; line-height: 1.4; font-size: 13px; padding: 4px 0;">`;

        if (addressText) {
            content += `
                <div style="display:flex;align-items:flex-start;margin-bottom:12px;padding:8px 0;border-bottom:2px solid #0079c1;">
                    <div style="font-weight:600;color:#0079c1;white-space:nowrap;flex-shrink:0;min-width:90px;font-size:13px;">Location:</div>
                    <div style="color:#323232;word-wrap:break-word;flex:1;margin-left:8px;font-size:13px;font-weight:500;">${escapePopupHtml(addressText)}</div>
                </div>
            `;
        }

        const populatedResults = results.filter(r => r.features.length > 0);
        const totalFeatures = populatedResults.reduce((acc, r) => acc + r.features.length, 0);

        if (totalFeatures === 0) {
            if (!addressText) {
                content += `<div style="color:#6e6e6e;font-style:italic;text-align:center;padding:20px;background-color:#f8f9fa;border-radius:4px;margin:10px 0;">No information found at this location.</div>`;
            } else {
                content += `<div style="color:#6e6e6e;font-style:italic;padding:10px 0;font-size:12px;">No features found at this location.</div>`;
            }
        } else {
            content += `<div style="font-size:12px;color:#6e6e6e;margin-bottom:10px;">Found <strong>${totalFeatures}</strong> feature${totalFeatures === 1 ? '' : 's'} across <strong>${populatedResults.length}</strong> layer${populatedResults.length === 1 ? '' : 's'}. Click an item to view details.</div>`;

            populatedResults.forEach(({ layerName, features, layerUrl, popupEnabled, mapLayer }, layerIndex) => {
                // Resolve the original result index so click handlers can look up
                // the right entry (populatedResults may be shorter than results).
                const originalIndex = results.indexOf(populatedResults[layerIndex]);

                if (showLayerNames) {
                    content += `
                        <div style="font-weight:600;color:#323232;margin:${layerIndex > 0 ? '14px' : '0px'} 0 6px 0;padding-bottom:4px;border-bottom:2px solid #0079c1;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">
                            ${escapePopupHtml(layerName)} <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#6e6e6e;font-size:12px;">(${features.length})</span>
                        </div>
                    `;
                }

                features.forEach((feature, featureIndex) => {
                    const label = getFeatureRowLabel(feature, layerUrl, mapLayer);
                    const safeLabel = escapePopupHtml(label);

                    if (popupEnabled) {
                        // Inline event handlers (onclick, etc.) are stripped by
                        // Esri's popup HTML sanitizer. Instead we mark each row
                        // with data-* attributes and CSS classes; openWhatsHerePopup
                        // attaches real DOM listeners after parsing this HTML.
                        content += `
                            <div class="rc-wh-row rc-wh-row--clickable"
                                 role="button" tabindex="0"
                                 data-rc-action="show-feature"
                                 data-rc-layer-idx="${originalIndex}"
                                 data-rc-feature-idx="${featureIndex}"
                                 title="View details">
                                <span class="rc-wh-row__label">${safeLabel}</span>
                                <span class="rc-wh-row__chevron">›</span>
                            </div>
                        `;
                    } else {
                        content += `
                            <div class="rc-wh-row rc-wh-row--disabled" title="Popups are disabled for this layer">
                                <span class="rc-wh-row__label">${safeLabel}</span>
                                <span class="rc-wh-row__hint">popups disabled</span>
                            </div>
                        `;
                    }
                });
            });
        }

        content += '</div>';
        return content;
    }, [props.config?.uiSettings, themeFont, escapePopupHtml, getFeatureRowLabel]);

    // Build the detail view: Back button + layer header + attribute list for
    // one feature. Reuses the existing getFieldDisplayName / formatFieldValue
    // helpers so formatting matches the rest of the widget.
    const generateFeatureDetailContent = React.useCallback((
        layerName: string,
        layerUrl: string,
        feature: any,
        mapLayerOverride?: any,
        overrideBodyHtml?: string,
        overrideHeaderText?: string
    ): string => {
        const uiSettings = props.config?.uiSettings || {};
        const showFieldAliases = uiSettings.showFieldAliases !== false;
        const attributes = feature?.attributes || {};
        const mapLayer = mapLayerOverride || findMapLayerByUrl(layerUrl);

        let content = `<div style="font-family: ${themeFont}; color: #323232; line-height: 1.4; font-size: 13px; padding: 4px 0;">`;

        // Back button + layer name header + Zoom-to button. Inline event
        // handlers are stripped by Esri's popup sanitizer; wireDetailActions
        // attaches the listeners after parsing this HTML.
        const headerText = (overrideHeaderText && overrideHeaderText.trim()) || layerName;
        content += `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #0079c1;">
                <button type="button" class="rc-wh-back" data-rc-action="show-master" title="Back to What's Here list">
                    <span style="font-size:14px;line-height:1;">‹</span> Back
                </button>
                <div style="flex:1;min-width:0;font-weight:600;color:#323232;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapePopupHtml(headerText)}">${escapePopupHtml(headerText)}</div>
                <button type="button" class="rc-wh-zoom-to" data-rc-action="zoom-to-feature" title="Zoom map to this feature">
                    <span style="font-size:13px;line-height:1;" aria-hidden="true">⊕</span> Zoom to
                </button>
            </div>
        `;

        // When a dev-override body has been pre-rendered (Arcade evaluated and
        // placeholders substituted), use it verbatim instead of trying to
        // render the layer's own popupTemplate. The body is trusted HTML
        // authored by the developer in widget settings, so we don't escape it.
        if (typeof overrideBodyHtml === 'string') {
            content += `<div class="rc-wh-override-body">${overrideBodyHtml}</div>`;
            content += '</div>';
            return content;
        }

        const systemFields = new Set(['OBJECTID', 'ObjectID', 'FID', 'SHAPE', 'Shape', 'GlobalID', 'GLOBALID']);

        // Build a lowercased index over the attribute keys so {field} lookups
        // in popup templates work case-insensitively (Esri service-author casing
        // often differs from popupTemplate-author casing).
        const attrKeyByLower: Record<string, string> = {};
        for (const k of Object.keys(attributes)) attrKeyByLower[k.toLowerCase()] = k;

        const getAttr = (name: string): any => {
            if (name in attributes) return attributes[name];
            const lo = name.toLowerCase();
            const realKey = attrKeyByLower[lo];
            return realKey !== undefined ? attributes[realKey] : undefined;
        };

        // Resolve an alias for a given field name, preferring (in order):
        //   1. an explicit popupTemplate fieldInfo.label
        //   2. the live layer's fields[].alias
        //   3. the cached state.layerFieldMetadata (for configured layers)
        //   4. common-aliases fallback via getFieldDisplayName
        const resolveAlias = (fieldName: string, explicitLabel?: string): string => {
            if (explicitLabel && explicitLabel !== fieldName) return explicitLabel;
            if (showFieldAliases && mapLayer?.fields) {
                const f = (mapLayer.fields as any[]).find?.((x: any) => x?.name?.toLowerCase() === fieldName.toLowerCase());
                if (f?.alias && f.alias !== fieldName) return f.alias;
            }
            return getFieldDisplayName(fieldName, layerUrl, showFieldAliases);
        };

        // Substitute {field} placeholders in popup-template strings. Field
        // values are HTML-escaped (matches Esri's standard convention).
        // {expression/...} placeholders are emptied here — webmap-authored
        // Arcade isn't evaluated by this widget; devs can configure
        // expressionInfos via the Popup Overrides (Arcade) settings instead.
        const substituteTemplateString = (tpl: string): string => {
            if (!tpl) return '';
            return tpl.replace(/\{([^{}]+)\}/g, (_full, raw: string) => {
                const ph = raw.trim();
                if (/^expression\//i.test(ph)) return '';
                const fieldName = ph.split(':')[0].trim();
                const v = getAttr(fieldName);
                if (v === null || v === undefined) return '';
                return escapePopupHtml(String(v));
            });
        };

        // Render one fields-content row table from a fieldInfos array.
        const renderFieldRows = (fieldInfos: any[]): string => {
            const rows = fieldInfos
                .filter((fi: any) => fi && fi.fieldName && fi.visible !== false && !systemFields.has(fi.fieldName))
                .map((fi: any) => {
                    const value = getAttr(fi.fieldName);
                    if (value === null || value === undefined || value === '') return null;
                    const label = resolveAlias(fi.fieldName, fi.label);
                    const formatted = formatFieldValue(value, fi.fieldName);
                    return `
                        <div style="display:flex;align-items:flex-start;margin-bottom:6px;padding:2px 0;min-height:20px;">
                            <div style="font-weight:600;color:#0079c1;white-space:nowrap;flex-shrink:0;min-width:120px;font-size:13px;line-height:1.4;">${escapePopupHtml(label)}:</div>
                            <div style="color:#323232;word-wrap:break-word;flex:1;margin-left:8px;font-size:13px;line-height:1.4;">${escapePopupHtml(formatted)}</div>
                        </div>
                    `;
                })
                .filter((r): r is string => r !== null);
            return rows.join('');
        };

        // Render every non-system attribute as a label/value row — used as
        // the ultimate fallback when neither popupTemplate.content nor
        // popupTemplate.fieldInfos yields anything.
        const renderAllAttributes = (): string => {
            const entries = Object.entries(attributes).filter(([name, v]) => {
                if (systemFields.has(name)) return false;
                return v !== null && v !== undefined && v !== '';
            });
            if (entries.length === 0) return '';
            return entries.map(([name, value]) => {
                const label = resolveAlias(name);
                const formatted = formatFieldValue(value, name);
                return `
                    <div style="display:flex;align-items:flex-start;margin-bottom:6px;padding:2px 0;min-height:20px;">
                        <div style="font-weight:600;color:#0079c1;white-space:nowrap;flex-shrink:0;min-width:120px;font-size:13px;line-height:1.4;">${escapePopupHtml(label)}:</div>
                        <div style="color:#323232;word-wrap:break-word;flex:1;margin-left:8px;font-size:13px;line-height:1.4;">${escapePopupHtml(formatted)}</div>
                    </div>
                `;
            }).join('');
        };

        // Render the layer's own popupTemplate.content if it's a shape we
        // understand. Returns '' if nothing renderable was found so we can
        // fall through to the final all-attributes fallback.
        const renderPopupTemplateBody = (): string => {
            const tpl = mapLayer?.popupTemplate;
            if (!tpl) return '';

            const tplContent = tpl.content;
            // String content — substitute {field} placeholders and render
            // as HTML.
            if (typeof tplContent === 'string') {
                const filled = substituteTemplateString(tplContent);
                return filled.trim() ? filled : '';
            }

            // Array content — webmap-authored popups commonly use an array of
            // content elements (TextContent with `text`, FieldsContent with
            // `fieldInfos`, etc.). Render each known type.
            if (Array.isArray(tplContent)) {
                const parts: string[] = [];
                for (const el of tplContent) {
                    if (!el) continue;
                    const elType = String(el.type || '').toLowerCase();
                    if (elType === 'text' && typeof el.text === 'string') {
                        const filled = substituteTemplateString(el.text);
                        if (filled.trim()) parts.push(`<div class="rc-wh-text">${filled}</div>`);
                    } else if (elType === 'fields' && Array.isArray(el.fieldInfos) && el.fieldInfos.length > 0) {
                        const rows = renderFieldRows(el.fieldInfos);
                        if (rows.trim()) parts.push(rows);
                    } else if (elType === 'media') {
                        // Lightweight support: list out media titles only —
                        // chart/image rendering is beyond this widget's scope.
                        const items: any[] = Array.isArray(el.mediaInfos) ? el.mediaInfos : [];
                        for (const mi of items) {
                            if (mi?.title) parts.push(`<div style="font-style:italic;color:#6e6e6e;font-size:12px;">${escapePopupHtml(mi.title)}</div>`);
                        }
                    }
                    // Unsupported types (attachments, custom) are skipped
                    // silently — the all-attributes fallback below will fire
                    // if nothing else rendered.
                }
                return parts.join('');
            }

            // Function content (sync/async) — we'd need to await it; skipped
            // here in favor of fieldInfos / all-attributes fallback.
            return '';
        };

        // Render order:
        //   1. popupTemplate.content (string/array) — what the webmap author
        //      actually configured for clicks
        //   2. popupTemplate.fieldInfos at top level (older popup style)
        //   3. Every non-system attribute (last-resort fallback)
        let body = renderPopupTemplateBody();

        if (!body.trim()) {
            const topFieldInfos: any[] = mapLayer?.popupTemplate?.fieldInfos || [];
            if (Array.isArray(topFieldInfos) && topFieldInfos.length > 0) {
                body = renderFieldRows(topFieldInfos);
            }
        }

        if (!body.trim()) {
            body = renderAllAttributes();
        }

        if (!body.trim()) {
            content += `<div style="color:#6e6e6e;font-style:italic;text-align:center;padding:20px;">No attributes to display for this feature.</div>`;
        } else {
            content += body;
        }

        content += '</div>';
        return content;
    }, [props.config?.uiSettings, themeFont, escapePopupHtml, findMapLayerByUrl, getFieldDisplayName, formatFieldValue]);

    // ─── Popup override (Arcade) helpers ────────────────────────────────────
    // A developer-supplied override is a {matchUrl, matchTitle, content,
    // expressionInfos} record in config.popupOverrides. At click time we
    // pick the first enabled override whose match fields are substrings of
    // the live layer's URL/title, evaluate its Arcade expressions, then
    // substitute placeholders in the content template.

    // Find the first enabled override whose match fields are substrings of
    // the layer being inspected. If both matchUrl and matchTitle are set,
    // both must match; if only one is set, only that one must match.
    const findMatchingPopupOverride = React.useCallback((
        layerName: string,
        layerUrl: string
    ): PopupOverrideConfig | null => {
        const overrides = props.config?.popupOverrides;
        if (!overrides || overrides.length === 0) return null;
        const urlLower = (layerUrl || '').toLowerCase();
        const titleLower = (layerName || '').toLowerCase();

        // Sort by specificity so more-specific overrides win over global
        // ones. Specificity = number of non-empty matchers (0–2). Stable
        // within the same score so the developer's authored order still
        // breaks ties. Both matchers empty means "apply to every layer" —
        // a useful default but it has to lose to any override that names
        // a URL or title.
        const scored = overrides
            .map((o, i) => {
                const u = (o?.matchUrl || '').trim();
                const t = (o?.matchTitle || '').trim();
                let score = 0;
                if (u) score++;
                if (t) score++;
                return { o, i, score, u: u.toLowerCase(), t: t.toLowerCase() };
            })
            .sort((a, b) => (b.score - a.score) || (a.i - b.i));

        for (const { o, u, t } of scored) {
            if (!o || o.enabled === false) continue;
            if (u && !urlLower.includes(u)) continue;
            if (t && !titleLower.includes(t)) continue;
            return o as PopupOverrideConfig;
        }
        return null;
    }, [props.config?.popupOverrides]);

    // Evaluate each Arcade expressionInfo against the feature, returning a
    // map of name → string value. Errors are caught per-expression and
    // surfaced as "[Arcade error: …]" so the developer can see what failed.
    const evaluateOverrideExpressions = React.useCallback(async (
        expressionInfos: ArcadeExpressionInfo[] | undefined,
        feature: any,
        mapLayer: any
    ): Promise<Record<string, string>> => {
        const out: Record<string, string> = {};
        if (!Array.isArray(expressionInfos) || expressionInfos.length === 0) return out;

        let arcade: any;
        try {
            arcade = await loadArcadeModule();
        } catch (err) {
            for (const e of expressionInfos) {
                if (e?.name) out[e.name] = '[Arcade module unavailable]';
            }
            return out;
        }

        // Build a feature-graphic-like context. Arcade's executor accepts
        // plain objects with `attributes` and (optionally) `geometry`.
        const featureCtx = {
            attributes: feature?.attributes || {},
            geometry: feature?.geometry || null,
            layer: mapLayer || null
        };

        const profile = {
            variables: [
                { name: '$feature', type: 'feature' as const }
            ]
        };

        // Coerce an Arcade return value to a string suitable for substitution
        // into the {expression/<name>} placeholder. Arcade authors commonly
        // return one of several shapes — handle each rather than blindly
        // String()-ing everything (which produces "[object Object]" for any
        // dictionary return).
        const coerceArcadeResult = (value: any): string => {
            if (value === null || value === undefined) return '';
            if (typeof value === 'string') return value;
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            if (value instanceof Date) return value.toLocaleString();
            if (Array.isArray(value)) {
                // Arrays of content elements — render each child recursively
                // and concatenate. Useful when an Arcade author returns
                // multiple TextContent blocks.
                return value.map(v => coerceArcadeResult(v)).filter(Boolean).join('');
            }
            if (typeof value === 'object') {
                // Esri popup content-element shapes returned by Arcade. The
                // most common is TextContent: { type: 'text', text: '<html>' }
                // — which is what devs return when they're building up HTML
                // string content inside the Arcade expression itself.
                const t = String(value.type || '').toLowerCase();
                if (t === 'text' && typeof value.text === 'string') {
                    return value.text;
                }
                // FieldsContent — without the live feature attrs here we
                // can't substitute values, but we can list the field names
                // so the dev at least sees something useful.
                if (t === 'fields' && Array.isArray(value.fieldInfos)) {
                    return value.fieldInfos
                        .map((fi: any) => fi?.fieldName)
                        .filter(Boolean)
                        .join(', ');
                }
                // Last-resort: stringify so the dev can see the structure
                // and fix their expression, rather than the opaque
                // "[object Object]".
                try { return JSON.stringify(value); } catch (_) { return '[unsupported Arcade return type]'; }
            }
            return String(value);
        };

        for (const info of expressionInfos) {
            if (!info?.name || !info?.expression) continue;
            try {
                const executor = await arcade.createArcadeExecutor(info.expression, profile);
                const value = await executor.executeAsync({ $feature: featureCtx });
                out[info.name] = coerceArcadeResult(value);
            } catch (err) {
                const msg = (err && (err as any).message) ? (err as any).message : 'unknown';
                out[info.name] = `[Arcade error: ${msg}]`;
            }
        }
        return out;
    }, []);

    // Substitute {field} and {expression/<name>} placeholders in the content
    // template. Field values are HTML-escaped; Arcade results are inserted
    // verbatim (so devs can return HTML when they want to). This mirrors
    // Esri's standard popup-content behavior.
    const substituteOverrideTemplate = React.useCallback((
        template: string,
        attributes: Record<string, any>,
        expressionResults: Record<string, string>
    ): string => {
        if (!template) return '';

        // Pre-build lower-cased lookups for case-insensitive matching.
        const attrKeyByLower: Record<string, string> = {};
        for (const k of Object.keys(attributes || {})) attrKeyByLower[k.toLowerCase()] = k;
        const exprKeyByLower: Record<string, string> = {};
        for (const k of Object.keys(expressionResults || {})) exprKeyByLower[k.toLowerCase()] = k;

        return template.replace(/\{([^{}]+)\}/g, (_full, raw: string) => {
            const placeholder = raw.trim();
            const exprMatch = /^expression\/(.+)$/i.exec(placeholder);
            if (exprMatch) {
                const exprName = exprMatch[1].trim().toLowerCase();
                const realKey = exprKeyByLower[exprName];
                return realKey ? expressionResults[realKey] : '';
            }
            // Strip optional format spec like {field:DateString} — we don't
            // implement format options here, just take the field name.
            const fieldName = placeholder.split(':')[0].trim().toLowerCase();
            const realKey = attrKeyByLower[fieldName];
            if (!realKey) return '';
            const val = attributes[realKey];
            if (val === null || val === undefined) return '';
            return escapePopupHtml(String(val));
        });
    }, [escapePopupHtml]);

    // Orchestrator: opens the "What's Here" popup, wires the master/detail
    // navigation handlers onto window so onclick attributes in the popup HTML
    // can call back into React-managed state.
    const openWhatsHerePopup = React.useCallback((
        mapPoint: __esri.Point,
        addressText: string,
        rawResults: Array<{ layerName: string; features: any[]; layerUrl: string; popupEnabled?: boolean; mapLayer?: any }>
    ) => {
        const mapView = mapViewRef.current;
        if (!mapView) return;

        // Each result already carries popupEnabled when it came from
        // auto-discovery. For results coming from the legacy URL-based path
        // (no mapLayer), fall back to looking up the live layer by URL.
        const results = rawResults.map(r => ({
            ...r,
            popupEnabled: typeof r.popupEnabled === 'boolean'
                ? r.popupEnabled
                : isPopupEnabledForLayerUrl(r.layerUrl)
        }));

        whatsHereSessionRef.current = { mapPoint, addressText, results };

        const popupMaxHeight = props.config?.uiSettings?.popupMaxHeight || 400;

        // ─── Feature highlight & zoom helpers ──────────────────────────────
        // These live inside openWhatsHerePopup so they close over the current
        // mapView reference. They use a component-level ref so renderMaster /
        // renderFeature / the popup-close watcher can share the same handle.

        const clearHighlight = () => {
            const g = whatsHereHighlightRef.current;
            if (!g) return;
            try { (mapView as any).graphics.remove(g); } catch (err) {
                console.warn('[rightclick] Could not remove highlight graphic:', err);
            }
            whatsHereHighlightRef.current = null;
        };

        const highlightFeature = (feature: any) => {
            clearHighlight();
            const geom = feature?.geometry;
            if (!geom || !geom.type) {
                console.warn('[rightclick] No geometry available on feature — highlight skipped. Check that returnGeometry is enabled in the query.');
                return;
            }

            // Read developer-configurable highlight style from settings.
            // Defaults: 2px cyan outline, no fill — Esri's standard
            // selection-symbol colour.
            const hi: WhatsHereHighlightConfig = (props.config?.whatsHereHighlight as any) || {};
            const hexToRgb = (hex: string): [number, number, number] => {
                const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
                if (!m) return [0, 255, 255]; // fallback: Esri default cyan
                const v = parseInt(m[1], 16);
                return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
            };
            const fillEnabled = hi.fillEnabled === true;
            const fillRgb = hexToRgb(hi.fillColor || '#00FFFF');
            const outlineRgb = hexToRgb(hi.outlineColor || '#00FFFF');
            const outlineWidth = typeof hi.outlineWidth === 'number' && hi.outlineWidth > 0
                ? hi.outlineWidth
                : 2;
            // [0,0,0,0] is fully transparent; Esri renders it as no fill but
            // still requires a `color` property on simple-fill / simple-marker.
            const transparent: [number, number, number, number] = [0, 0, 0, 0];

            let symbol: any = null;
            const t = String(geom.type).toLowerCase();
            if (t === 'polygon' || t === 'extent') {
                symbol = {
                    type: 'simple-fill',
                    color: fillEnabled ? [...fillRgb, 0.35] : transparent,
                    outline: { color: [...outlineRgb, 1], width: outlineWidth }
                };
            } else if (t === 'polyline') {
                // Polylines have no fill — the outline color/width drive the
                // entire stroke. Bump the min width to 2 so the line is
                // visible regardless of configured outline width.
                symbol = {
                    type: 'simple-line',
                    color: [...outlineRgb, 1],
                    width: Math.max(outlineWidth, 2)
                };
            } else if (t === 'point' || t === 'multipoint') {
                symbol = {
                    type: 'simple-marker',
                    style: 'circle',
                    color: fillEnabled ? [...fillRgb, 0.85] : transparent,
                    outline: { color: [...outlineRgb, 1], width: Math.max(outlineWidth, 1.5) },
                    size: 14
                };
            }
            if (!symbol) {
                console.warn('[rightclick] Unsupported geometry type for highlight:', geom.type);
                return;
            }
            try {
                const g = new Graphic({ geometry: geom, symbol });
                (mapView as any).graphics.add(g);
                whatsHereHighlightRef.current = g;
            } catch (err) {
                console.warn('[rightclick] Could not add highlight graphic:', err);
            }
        };

        const zoomToFeature = (feature: any) => {
            const geom = feature?.geometry;
            if (!geom) {
                console.warn('[rightclick] No geometry available on feature — zoom-to skipped. Check that returnGeometry is enabled in the query.');
                return;
            }
            const t = String(geom.type || '').toLowerCase();
            const opts = { animate: true, duration: 500 };
            try {
                if (t === 'point') {
                    // A point has no extent — use it directly as the target,
                    // with a sensible zoom. Don't pull the user back out if
                    // they were already deeper than 18.
                    const targetZoom = Math.max((mapView as any).zoom || 0, 18);
                    (mapView as any).goTo({ target: geom, zoom: targetZoom }, opts);
                    return;
                }

                const ext: any = (geom as any).extent;
                if (!ext || !ext.center) {
                    // No extent (unusual for a non-point) — let Esri figure
                    // it out from the geometry as a last resort.
                    (mapView as any).goTo(geom, opts);
                    return;
                }

                // We need BOTH: pin the camera to the geometry's centre AND
                // zoom to fit the extent. Passing `target: geom` together
                // with `center: ext.center` to goTo gives centring but
                // *preserves the current scale* — so the camera just pans.
                // Compute the target scale ourselves and feed
                // {center, scale} explicitly so the single animation does
                // both jobs.
                //
                // Algorithm (mirrors what goTo(extent) does internally,
                // minus the view-padding offset that was breaking centring):
                //   1. Pad the extent ~10% for visual breathing room.
                //   2. Convert padded extent dimensions → map units per
                //      pixel (resolution) using the view's pixel width/height.
                //   3. Use the view's current scale/resolution ratio to
                //      convert that target resolution into a scale value
                //      in the same units the view uses.
                const padFactor = 1.1;
                const effWidth = Math.max((ext.width || 0) * padFactor, 0);
                const effHeight = Math.max((ext.height || 0) * padFactor, 0);

                const viewWidth = (mapView as any).width || 1;
                const viewHeight = (mapView as any).height || 1;
                const currentScale = (mapView as any).scale || 0;
                const currentResolution = (mapView as any).resolution || 0;

                if (effWidth <= 0 || effHeight <= 0) {
                    // Degenerate extent (collapsed to a point) — treat the
                    // extent's centre like a point and zoom in.
                    const z = Math.max((mapView as any).zoom || 0, 18);
                    (mapView as any).goTo({ target: ext.center, zoom: z }, opts);
                    return;
                }

                let targetScale = currentScale;
                if (currentResolution > 0 && currentScale > 0) {
                    const targetResolution = Math.max(
                        effWidth / viewWidth,
                        effHeight / viewHeight
                    );
                    targetScale = currentScale * (targetResolution / currentResolution);
                }

                (mapView as any).goTo(
                    { center: ext.center, scale: targetScale },
                    opts
                );
            } catch (err) {
                console.warn('[rightclick] view.goTo failed:', err);
            }
        };

        // Watch popup visibility so we clear the highlight when the user
        // dismisses the popup (X, click elsewhere, right-click again). Tear
        // down any previous watcher first so each session has exactly one.
        if (whatsHerePopupCloseHandleRef.current) {
            try { whatsHerePopupCloseHandleRef.current.remove(); } catch (_) { /* ignore */ }
            whatsHerePopupCloseHandleRef.current = null;
        }
        try {
            const popup: any = (mapView as any).popup;
            if (popup && typeof popup.watch === 'function') {
                whatsHerePopupCloseHandleRef.current = popup.watch('visible', (visible: boolean) => {
                    if (!visible) {
                        clearHighlight();
                        if (whatsHerePopupCloseHandleRef.current) {
                            try { whatsHerePopupCloseHandleRef.current.remove(); } catch (_) { /* ignore */ }
                            whatsHerePopupCloseHandleRef.current = null;
                        }
                    }
                });
            }
        } catch (_) { /* popup.watch may not exist on every JS API version */ }

        // Build the scrolling container as a real DOM element. We pass an
        // HTMLElement (not a string) to popup.content because Esri's popup
        // sanitizes string content and strips inline event handlers — passing
        // a DOM node lets us attach real listeners that survive.
        //
        // The container is user-resizable via the native CSS `resize` corner
        // handle (bottom-right). A ResizeObserver captures the chosen size
        // into whatsHerePopupSizeRef so the size persists across master↔
        // detail navigation and across subsequent right-clicks.
        const buildPopupRoot = (innerHtml: string): HTMLDivElement => {
            const root = document.createElement('div');
            // Marker class so the injected stylesheet can target the
            // surrounding `.esri-popup__main-container` via `:has()`.
            root.className = 'rc-wh-popup-root';
            const saved = whatsHerePopupSizeRef.current;
            const hasSaved = saved.width != null && saved.height != null && saved.width > 0 && saved.height > 0;

            // The inner wrapper just fills its parent slot inside the popup's
            // `.esri-popup__content` flex cell and scrolls if its content
            // overflows. The *popup main container* is what's actually
            // resizable now — see setupChromeResize below. This is the only
            // way to grow the popup horizontally on top of Esri's flex
            // layout: the inner wrapper having `resize: both` only changes
            // its own width and the parent content area clips it.
            root.style.cssText = [
                'width:100%',
                'height:100%',
                'overflow:auto',
                'padding:4px',
                'box-sizing:border-box',
                'min-width:280px'
            ].join(';');
            root.innerHTML = innerHtml;

            // Wire up the popup chrome (the `.esri-popup__main-container`
            // ancestor) as the resizable element. Has to run after Esri has
            // inserted our wrapper into the DOM, which happens during
            // openPopup — a small timeout is enough.
            const setupChromeResize = () => {
                // Find the popup main container ancestor.
                let mainContainer: HTMLElement | null = null;
                let node: HTMLElement | null = root.parentElement;
                let hops = 0;
                while (node && hops < 10) {
                    if (node.classList.contains('esri-popup__main-container')) {
                        mainContainer = node;
                        break;
                    }
                    node = node.parentElement;
                    hops++;
                }

                if (mainContainer) {
                    // resize: both requires a non-visible overflow value on
                    // the resizable element; the popup main container is
                    // already overflow:hidden by default (for rounded corner
                    // clipping), but set it explicitly for safety.
                    mainContainer.style.setProperty('resize', 'both', 'important');
                    mainContainer.style.setProperty('overflow', 'hidden', 'important');
                    mainContainer.style.setProperty('min-width', '320px', 'important');
                    mainContainer.style.setProperty('min-height', '200px', 'important');
                    mainContainer.style.setProperty('max-width', '92vw', 'important');
                    mainContainer.style.setProperty('max-height', '88vh', 'important');
                    // Esri's stylesheet sets `width: 100%` on the main
                    // container so it fills its position-container parent
                    // (which has the 350px max-width cap). Switching to
                    // explicit pixel width lets the user grow it freely.
                    if (hasSaved) {
                        mainContainer.style.setProperty('width', `${saved.width}px`, 'important');
                        mainContainer.style.setProperty('height', `${saved.height}px`, 'important');
                    } else {
                        // First-open default: roughly the previous popup size.
                        mainContainer.style.setProperty('width', '460px', 'important');
                        mainContainer.style.setProperty('height', `${popupMaxHeight + 40}px`, 'important');
                    }

                    // Observe the chrome for resize → persist the new size
                    // into whatsHerePopupSizeRef. Skip the first fire (initial
                    // layout) so we don't pin to the default 460×N before the
                    // user has touched anything.
                    if (typeof ResizeObserver !== 'undefined' && !(mainContainer as any).__rcResizeObserver) {
                        let firstFire = true;
                        const ro = new ResizeObserver(() => {
                            if (firstFire) { firstFire = false; return; }
                            const w = (mainContainer as HTMLElement).offsetWidth;
                            const h = (mainContainer as HTMLElement).offsetHeight;
                            if (w > 0 && h > 0) {
                                whatsHerePopupSizeRef.current = { width: w, height: h };
                            }
                        });
                        try { ro.observe(mainContainer); } catch (_) { /* ignore */ }
                        (mainContainer as any).__rcResizeObserver = ro;
                    }
                }

                // Independent of the main-container resize, also lift the
                // size caps on every popup-chrome ancestor inline — covers
                // browsers without :has() support and cases where Esri sets
                // inline styles that beat stylesheet rules.
                let n2: HTMLElement | null = root.parentElement;
                let h2 = 0;
                while (n2 && h2 < 10) {
                    const cls = n2.classList;
                    if (
                        cls.contains('esri-popup') ||
                        cls.contains('esri-popup__position-container')
                    ) {
                        n2.style.setProperty('max-width', '92vw', 'important');
                        n2.style.setProperty('max-height', '88vh', 'important');
                    }
                    if (cls.contains('esri-popup__content')) {
                        // Remove the content area's own height & width caps
                        // so it expands to fill its (now-resized) parent.
                        n2.style.setProperty('max-height', 'none', 'important');
                        n2.style.setProperty('max-width', 'none', 'important');
                    }
                    if (cls.contains('esri-popup')) break;
                    n2 = n2.parentElement;
                    h2++;
                }
            };
            // Run twice — Esri sometimes resets inline styles on its own
            // first layout pass; a second tick after that wins.
            setTimeout(setupChromeResize, 0);
            setTimeout(setupChromeResize, 60);

            return root;
        };

        const renderMaster = () => {
            const session = whatsHereSessionRef.current;
            if (!session) return;
            // Returning to the master list clears the feature highlight —
            // the user is no longer looking at any one feature.
            clearHighlight();
            whatsHereMasterIsActiveRef.current = true;
            const root = buildPopupRoot(generateMasterWhatsHereContent(session.addressText, session.results));

            // Helper to resolve the feature for a given row's li/fi pair from
            // the current session. Returns null if the session has been torn
            // down or the indices no longer point at anything.
            const featureForRow = (li: number, fi: number): any | null => {
                const sess = whatsHereSessionRef.current;
                if (!sess) return null;
                const layerResult = sess.results[li];
                if (!layerResult) return null;
                return layerResult.features[fi] || null;
            };

            // Wire up click + keyboard listeners + hover-to-highlight on every
            // clickable row. Hover and focus produce the same map highlight
            // the detail view will use — same configured colour, same
            // Graphic — so the user can preview features by mousing over
            // the list before committing.
            const rows = root.querySelectorAll<HTMLElement>('[data-rc-action="show-feature"]');
            rows.forEach(el => {
                const li = parseInt(el.getAttribute('data-rc-layer-idx') || '-1', 10);
                const fi = parseInt(el.getAttribute('data-rc-feature-idx') || '-1', 10);
                if (li < 0 || fi < 0) return;

                el.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    renderFeature(li, fi);
                });
                el.addEventListener('keydown', (ev: KeyboardEvent) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        ev.stopPropagation();
                        renderFeature(li, fi);
                    }
                });

                // Hover: highlight the feature on the map. The map graphic
                // uses the same configured highlight style as the detail
                // view, so the user gets a consistent visual.
                el.addEventListener('mouseenter', () => {
                    const f = featureForRow(li, fi);
                    if (f) highlightFeature(f);
                });
                el.addEventListener('mouseleave', () => {
                    // Critical guard: a click on this row will fire its click
                    // handler BEFORE mouseleave does, transitioning to the
                    // detail view which calls highlightFeature(f) itself.
                    // If we cleared unconditionally here, that detail-view
                    // highlight would be wiped a moment later. Only clear
                    // when we're still showing the master list.
                    if (whatsHereMasterIsActiveRef.current) clearHighlight();
                });

                // Keyboard parity: tabbing onto a row should produce the
                // same preview highlight a hover would.
                el.addEventListener('focus', () => {
                    const f = featureForRow(li, fi);
                    if (f) highlightFeature(f);
                });
                el.addEventListener('blur', () => {
                    if (whatsHereMasterIsActiveRef.current) clearHighlight();
                });
            });

            (mapView as any).openPopup({
                title: "📍 What's here?",
                content: root,
                location: session.mapPoint
            });
        };

        // Helper to wire up the Back button AND the Zoom-to button on a
        // freshly-built detail-view popup root. The Zoom-to handler needs a
        // reference to the current feature, which is why this can't live in
        // buildPopupRoot itself.
        const wireDetailActions = (root: HTMLElement, feature: any) => {
            const backBtns = root.querySelectorAll<HTMLElement>('[data-rc-action="show-master"]');
            backBtns.forEach(el => {
                el.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    renderMaster();
                });
                el.addEventListener('keydown', (ev: KeyboardEvent) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        ev.stopPropagation();
                        renderMaster();
                    }
                });
            });

            const zoomBtns = root.querySelectorAll<HTMLElement>('[data-rc-action="zoom-to-feature"]');
            zoomBtns.forEach(el => {
                el.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    zoomToFeature(feature);
                });
                el.addEventListener('keydown', (ev: KeyboardEvent) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        ev.stopPropagation();
                        zoomToFeature(feature);
                    }
                });
            });
        };

        // Token guarding against stale async renders. If the user clicks
        // another feature (or right-clicks again) before our Arcade promise
        // resolves, we don't want the old click's content to land on top.
        let featureRenderToken = 0;

        const renderFeature = (layerIndex: number, featureIndex: number) => {
            const session = whatsHereSessionRef.current;
            if (!session) return;
            const layerResult = session.results[layerIndex];
            if (!layerResult) return;
            const feature = layerResult.features[featureIndex];
            if (!feature) return;

            // Leaving the master list. Flip the flag so any pending
            // mouseleave/blur events from master rows don't wipe the
            // detail-view highlight we're about to set.
            whatsHereMasterIsActiveRef.current = false;

            // Highlight on the map as soon as the user picks a feature. This
            // also clears any previous highlight in case the user is hopping
            // between features without going through the master view.
            highlightFeature(feature);

            const myToken = ++featureRenderToken;
            const override = findMatchingPopupOverride(layerResult.layerName, layerResult.layerUrl);

            // Synchronous fast path: no override → just render the standard
            // attribute list immediately. (Most layers will hit this.)
            if (!override) {
                const root = buildPopupRoot(generateFeatureDetailContent(
                    layerResult.layerName,
                    layerResult.layerUrl,
                    feature,
                    layerResult.mapLayer
                ));
                wireDetailActions(root, feature);
                (mapView as any).openPopup({
                    title: "📍 What's here?",
                    content: root,
                    location: session.mapPoint
                });
                return;
            }

            // Override path: evaluate Arcade asynchronously, then render.
            // We open a transitional "Loading…" popup first so the user gets
            // immediate feedback that their click registered. The Back button
            // works in this transitional state too.
            const loadingRoot = buildPopupRoot(generateFeatureDetailContent(
                layerResult.layerName,
                layerResult.layerUrl,
                feature,
                layerResult.mapLayer,
                `<div style="color:#6e6e6e;padding:20px;text-align:center;font-style:italic;">Loading…</div>`,
                override.title || undefined
            ));
            wireDetailActions(loadingRoot, feature);
            (mapView as any).openPopup({
                title: "📍 What's here?",
                content: loadingRoot,
                location: session.mapPoint
            });

            (async () => {
                let body: string;
                try {
                    const exprResults = await evaluateOverrideExpressions(
                        override.expressionInfos,
                        feature,
                        layerResult.mapLayer
                    );
                    body = substituteOverrideTemplate(
                        override.content || '',
                        feature.attributes || {},
                        exprResults
                    );
                } catch (err) {
                    const msg = (err && (err as any).message) ? (err as any).message : 'unknown';
                    body = `<div style="color:#d32f2f;padding:12px;"><strong>Error rendering custom popup:</strong> ${escapePopupHtml(msg)}</div>`;
                }

                // Bail out if a newer renderFeature call has already started.
                if (myToken !== featureRenderToken) return;
                const session2 = whatsHereSessionRef.current;
                if (!session2) return;

                const finalRoot = buildPopupRoot(generateFeatureDetailContent(
                    layerResult.layerName,
                    layerResult.layerUrl,
                    feature,
                    layerResult.mapLayer,
                    body,
                    override.title || undefined
                ));
                wireDetailActions(finalRoot, feature);
                (mapView as any).openPopup({
                    title: "📍 What's here?",
                    content: finalRoot,
                    location: session2.mapPoint
                });
            })();
        };

        renderMaster();
    }, [isPopupEnabledForLayerUrl, generateMasterWhatsHereContent, generateFeatureDetailContent, findMatchingPopupOverride, evaluateOverrideExpressions, substituteOverrideTemplate, escapePopupHtml, props.config?.uiSettings?.popupMaxHeight]);

    // Inject a stylesheet for the What's Here popup rows once on mount. Esri's
    // popup HTML sanitizer disallows pseudo-class selectors in inline `style`,
    // but a stylesheet in document.head applies normally to the popup content
    // since the popup renders into the same document.
    React.useEffect(() => {
        const STYLE_ID = 'rc-whats-here-styles';
        if (document.getElementById(STYLE_ID)) return;
        const styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = `
.rc-wh-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin-bottom: 4px; border-radius: 4px; box-sizing: border-box; }
.rc-wh-row--clickable { background: #f4f8fb; border: 1px solid #d9e6ef; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.rc-wh-row--clickable:hover, .rc-wh-row--clickable:focus { background: #e3eef6; border-color: #0079c1; outline: none; }
.rc-wh-row--clickable:focus-visible { box-shadow: 0 0 0 2px rgba(0, 121, 193, 0.35); }
.rc-wh-row--disabled { background: #fafafa; border: 1px solid #e0e0e0; color: #6e6e6e; }
.rc-wh-row__label { flex: 1; color: #0079c1; font-weight: 500; }
.rc-wh-row--disabled .rc-wh-row__label { color: #6e6e6e; font-weight: 400; }
.rc-wh-row__chevron { color: #0079c1; font-size: 16px; line-height: 1; font-weight: 600; }
.rc-wh-row__hint { font-size: 11px; color: #999; font-style: italic; }
.rc-wh-back { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; background: #fff; border: 1px solid #0079c1; color: #0079c1; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit; line-height: 1.2; transition: background 0.15s, color 0.15s; flex-shrink: 0; }
.rc-wh-back:hover, .rc-wh-back:focus { background: #0079c1; color: #fff; outline: none; }
.rc-wh-back:focus-visible { box-shadow: 0 0 0 2px rgba(0, 121, 193, 0.35); }
.rc-wh-zoom-to { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; background: #fff; border: 1px solid #0079c1; color: #0079c1; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit; line-height: 1.2; transition: background 0.15s, color 0.15s; flex-shrink: 0; }
.rc-wh-zoom-to:hover, .rc-wh-zoom-to:focus { background: #0079c1; color: #fff; outline: none; }
.rc-wh-zoom-to:focus-visible { box-shadow: 0 0 0 2px rgba(0, 121, 193, 0.35); }

/* Make the host popup chrome itself the resizable element when our
 * What's Here wrapper is mounted inside it. The CSS resize property needs
 * a non-visible overflow value to render the corner grip — the popup
 * main container already has overflow:hidden by default for rounded-corner
 * clipping, so this works in concert. Putting the resize affordance here
 * (instead of on the inner wrapper) is the only reliable way to grow the
 * popup horizontally on top of Esri's flex layout: the wrapper-resize
 * approach only changed the wrapper's own width and the parent content
 * area clipped it. */
.esri-popup__main-container:has(.rc-wh-popup-root) {
    resize: both !important;
    overflow: hidden !important;
    min-width: 320px !important;
    min-height: 200px !important;
    max-width: 92vw !important;
    max-height: 88vh !important;
}
.esri-popup:has(.rc-wh-popup-root),
.esri-popup__position-container:has(.rc-wh-popup-root) {
    max-width: 92vw !important;
    max-height: 88vh !important;
}
.esri-popup__content:has(.rc-wh-popup-root) {
    max-height: none !important;
    max-width: none !important;
}
.rc-wh-popup-root { box-sizing: border-box; }
        `.trim();
        document.head.appendChild(styleEl);
        // Don't remove on unmount — the stylesheet is idempotent and inexpensive,
        // and another widget instance may still be using it.
    }, []);

    const handleContextMenuAction = React.useCallback((action: string) => {
        const { mapPoint, projectedLatLon } = state.contextMenu;
        const mapView = mapViewRef.current;

        if (!mapView || !mapPoint) {
            hideContextMenu();
            return;
        }

        switch (action) {
            case 'zoom-in':
                mapView.goTo({ target: mapPoint, zoom: mapView.zoom + 1 }).catch(() => { });
                break;
            case 'zoom-out':
                mapView.goTo({ target: mapPoint, zoom: mapView.zoom - 1 }).catch(() => { });
                break;
            case 'center-here':
                mapView.goTo({ target: mapPoint }).catch(() => { });
                break;
            case 'get-coordinates':
                copyCoordinates();
                break;
            case 'plot-coordinates':
                plotCoordinate();
                break;
            case 'plot-marker':
                plotSimpleMarker();
                break;
            // NEW: Add text action
            case 'add-text':
                showTextInputDialog();
                break;
            case 'clear-coordinates':
                clearCoordinateMarkers();
                break;
            case 'clear-markers':
                clearSimpleMarkers();
                break;
            case 'clear-text':
                clearTextGraphics();
                break;
            // UPDATED: Renamed from clear-all-markers to clear-all-graphics
            case 'clear-all-graphics':
                clearAllGraphics();
                break;
            case 'street-view':
                openStreetView();
                break;
            case 'pictometry':
                openPictometryView();
                break;
            case 'measure-distance':
                startMeasurement();
                break;
            case 'measure-area':
                startAreaMeasurement();
                break;
            case 'whats-here': {
                const handleWhatsHere = async () => {
                    hideContextMenu(); // hide menu immediately before async work begins
                    try {
                        type ResultRow = { layerName: string; features: any[]; layerUrl: string; popupEnabled?: boolean; mapLayer?: any };
                        let allResults: ResultRow[] = [];

                        let addressText = '';
                        if (props.config?.reverseGeocodeUrl) {
                            // Build a WGS84 point for the locator using pre-computed projectedLatLon
                            // (already accurate from right-click). Avoids projectToSpatialReference
                            // which calls projectOperator.load() — that can hang in local dev (WASM
                            // blocked by CSP) and never reject, stalling the entire async function.
                            const { lat, lon } = projectedLatLon ?? manualProjectToLatLon(mapPoint);

                            try {
                                // Build a plain object point — avoids needing esri/geometry/Point constructor
                                const geoPoint = { x: lon, y: lat, spatialReference: { wkid: 4326 } };

                                const response: any = await (locator as any).locationToAddress(
                                    props.config.reverseGeocodeUrl,
                                    { location: geoPoint, distance: 1000, outSR: { wkid: 4326 } }
                                );

                                const raw = response?.address ||
                                    response?.attributes?.Match_addr ||
                                    response?.attributes?.Address ||
                                    response?.attributes?.StAddr ||
                                    response?.attributes?.Street || '';
                                addressText = typeof raw === 'string' ? raw : '';

                            } catch (error) {
                                // Geocode failed — fall back to showing coordinates
                                addressText = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
                            }
                        }

                        const normalizeUrl = (u: string) => (u || '').replace(/\/+$/, '').toLowerCase();
                        const seenUrls = new Set<string>();

                        // ── 1) Auto-discovery from the map ─────────────────
                        // Walk every queryable layer in the live map (FeatureLayers
                        // and MapImageLayer/TileLayer sublayers, including those
                        // nested arbitrarily deep in GroupLayers / map service
                        // group sublayers) and query each at the click point. This
                        // makes "What's Here" work out of the box with any webmap
                        // — no per-layer configuration required.
                        const discovered = collectQueryableLayersFromMap();
                        if (discovered.length > 0) {
                            const settled = await Promise.allSettled(
                                discovered.map(entry => queryLayerEntryAtPoint(entry, mapPoint))
                            );
                            for (const r of settled) {
                                if (r.status !== 'fulfilled') continue;
                                if (!r.value.features.length) continue;
                                const key = normalizeUrl(r.value.layerUrl);
                                if (key) {
                                    if (seenUrls.has(key)) continue;
                                    seenUrls.add(key);
                                }
                                allResults.push(r.value);
                            }
                        }

                        // ── 2) Manually configured feature layers ──────────
                        // Anything the user explicitly added in widget settings
                        // is still queried via the REST path. Deduped by URL
                        // against auto-discovered results so we don't double up.
                        if (props.config?.featureLayers?.length) {
                            const configToQuery = props.config.featureLayers.filter(l => {
                                const key = normalizeUrl(l.url || '');
                                return key ? !seenUrls.has(key) : true;
                            });
                            if (configToQuery.length > 0) {
                                const cfgSettled = await Promise.allSettled(
                                    configToQuery.map(async (layer) => {
                                        try { return await queryFeatureLayer(layer, mapPoint); }
                                        catch { return { layerName: layer.name, features: [], layerUrl: layer.url }; }
                                    })
                                );
                                for (const r of cfgSettled) {
                                    if (r.status !== 'fulfilled') continue;
                                    if (!r.value.features.length) continue;
                                    const key = normalizeUrl(r.value.layerUrl);
                                    if (key) {
                                        if (seenUrls.has(key)) continue;
                                        seenUrls.add(key);
                                    }
                                    allResults.push(r.value);
                                }
                            }
                        }

                        // Hand off to the master/detail orchestrator. It renders the
                        // address + clickable feature list and wires up the back/forward
                        // navigation handlers on `window` for use by onclick attributes
                        // in the popup HTML.
                        openWhatsHerePopup(mapPoint, addressText, allResults);

                    } catch (error) {
                        (mapView as any).openPopup({
                            title: "📍 What's here?",
                            content: '<div style="color:#d32f2f;padding:16px;text-align:center;"><strong>Error querying location information.</strong></div>',
                            location: mapPoint
                        });
                    }
                };

                // Auto-discovery means we no longer need configured layers OR a
                // geocode URL to be useful — any webmap with queryable layers
                // will produce a result. Only bail when literally nothing is
                // available (no geocode AND no map layers loaded yet).
                const mv = mapViewRef.current;
                const hasAnyLayers = !!mv?.map && (((mv.map as any).allLayers?.items?.length || 0) > 0);
                if (!props.config?.reverseGeocodeUrl && !hasAnyLayers && (!props.config?.featureLayers || props.config.featureLayers.length === 0)) {
                    alert("What's Here functionality requires the map to have layers loaded, or a geocoding service URL, or feature layers configured in widget settings.");
                    break;
                }

                handleWhatsHere();
                return; // skip the hideContextMenu() at the bottom — openPopup handles its own state
            }
            case 'property-report': {
                const targetWidgetId = props.config?.propertyReportSettings?.targetWidgetId;

                if (targetWidgetId) {
                    try {
                        const pointData = {
                            x: mapPoint.x,
                            y: mapPoint.y,
                            spatialReference: mapPoint.spatialReference?.toJSON?.() || mapPoint.spatialReference || { wkid: 4326 }
                        };

                        const containerType = props.config?.propertyReportSettings?.parentContainerType;
                        openContainerAndTarget(targetWidgetId, containerType);

                        const sendPoint = (delay: number) => {
                            setTimeout(() => {
                                try {
                                    MutableStoreManager.getInstance().updateStateValue(targetWidgetId, 'actionPoint', {
                                        point: pointData,
                                        address: null,
                                        autoOpenSection: null,
                                        timestamp: Date.now()
                                    });
                                    getAppStore().dispatch(
                                        appActions.widgetStatePropChange(targetWidgetId, 'actionTriggered', true)
                                    );
                                } catch { /* silent */ }
                            }, delay);
                        };

                        sendPoint(350);
                        sendPoint(1000);
                        sendPoint(1800);
                    } catch (err) {
                        console.error('Right-Click: Error triggering Property Report widget', err);
                    }
                }
                break;
            }
            case 'mailing-labels': {
                // Defer launch — first ask the user whether to apply a buffer.
                // launchMailingLabels (invoked by the dialog buttons) does the
                // actual controller open + MutableStoreManager update.
                if (props.config?.mailingLabelsSettings?.targetWidgetId) {
                    showMailingLabelsBufferDialog();
                }
                break;
            }
        }

        hideContextMenu();
    }, [state.contextMenu, hideContextMenu, copyCoordinates, plotCoordinate, plotSimpleMarker, showTextInputDialog, clearCoordinateMarkers, clearSimpleMarkers, clearTextGraphics, clearAllGraphics, openStreetView, openPictometryView, startMeasurement, startAreaMeasurement, projectToSpatialReference, queryFeatureLayer, collectQueryableLayersFromMap, queryLayerEntryAtPoint, openWhatsHerePopup, showMailingLabelsBufferDialog, openContainerAndTarget, props.config, getFieldDisplayName]);

    const onActiveViewChange = React.useCallback((jmv: JimuMapView) => {
        if (jmv?.view) {
            const mapView = jmv.view as __esri.MapView;
            mapViewRef.current = mapView;

            // Only attach handlers once per map view instance
            if (handlersAttachedRef.current && lastMapViewRef.current === mapView) {
                return;
            }

            lastMapViewRef.current = mapView;
            handlersAttachedRef.current = true;

            mapView.when(() => {
                const container = mapView.container;

                // One-time permanent filter for projection / projectOperator CSP/WASM noise in local dev.
                // projectOperator.load() (and the legacy projection.load()) fail silently on the local
                // dev server (WASM blocked by CSP) but work correctly on Portal. The AMD loader emits a
                // 4-line sequence:
                //   console.error: Error: scriptError: .../projectOperator.js  (stack trace)
                //   console.log:   src: dojoLoader
                //   console.log:   info: [url, Event]
                //   console.log:   .
                // All four are suppressed below; all other output passes through unchanged.
                const _origConsoleError = console.error;
                const _origConsoleLog = console.log;
                const _isProjectionNoise = (...args: any[]): boolean => {
                    const s = String(args[0] || '');
                    return (
                        s.includes('projection.js') ||
                        s.includes('projectOperator.js') ||
                        s.includes('scriptError') ||
                        s.includes('dojoLoader') ||
                        /^(src:|info:|\.)\s*$/.test(s.trim())
                    );
                };
                console.error = (...args: any[]) => {
                    if (_isProjectionNoise(...args)) return;
                    _origConsoleError.apply(console, args);
                };
                console.log = (...args: any[]) => {
                    if (_isProjectionNoise(...args)) return;
                    _origConsoleLog.apply(console, args);
                };

                mapView.on('pointer-down', (event) => {
                    if (event.button === 2) {
                        if (event.native) {
                            event.native.preventDefault?.();
                            event.native.stopImmediatePropagation?.();
                        }

                        event.stopPropagation();

                        const mapPoint = mapView.toMap({ x: event.x, y: event.y });
                        const copySettings = props.config?.copySettings || {
                            coordinateSystem: 'map',
                            customWkid: undefined,
                            coordinateFormat: 'decimal',
                            decimalPlaces: 2
                        };

                        // Get quick coordinate label synchronously
                        let coordinateLabel: string;
                        if (copySettings.coordinateSystem === 'webMercator') {
                            const manualLatLon = manualProjectToLatLon(mapPoint);
                            if (copySettings.coordinateFormat === 'dms') {
                                coordinateLabel = `${convertToDMS(manualLatLon.lat, 'lat')}, ${convertToDMS(manualLatLon.lon, 'lon')}`;
                            } else {
                                coordinateLabel = `${manualLatLon.lat.toFixed(copySettings.decimalPlaces || 6)}, ${manualLatLon.lon.toFixed(copySettings.decimalPlaces || 6)}`;
                            }
                        } else {
                            coordinateLabel = `${mapPoint.x.toFixed(copySettings.decimalPlaces || 2)}, ${mapPoint.y.toFixed(copySettings.decimalPlaces || 2)}`;
                        }

                        const rect = container.getBoundingClientRect();
                        let x = event.x + rect.left;
                        let y = event.y + rect.top;

                        const menuWidth = 200;
                        const menuHeight = 450; // Use fixed estimate for positioning

                        // Clamp menu position within the map container bounds
                        const mapRight = rect.left + rect.width;
                        const mapBottom = rect.top + rect.height;

                        if (x + menuWidth > mapRight) {
                            x = Math.max(rect.left + 4, x - menuWidth);
                        }
                        if (y + menuHeight > mapBottom) {
                            y = Math.max(rect.top + 4, y - menuHeight);
                        }

                        // Ensure menu stays fully within map container
                        x = Math.max(rect.left + 4, Math.min(x, mapRight - menuWidth - 4));
                        y = Math.max(rect.top + 4, Math.min(y, mapBottom - menuHeight - 4));

                        // Set initial projectedLatLon from manual math immediately
                        const initialLatLon = manualProjectToLatLon(mapPoint);

                        setState(prevState => ({
                            ...prevState,
                            showingContextMenu: true,
                            contextMenu: {
                                visible: true,
                                x,
                                y,
                                mapPoint,
                                coordinateLabel,
                                projectedLatLon: initialLatLon
                            }
                        }));

                        // Always refine projectedLatLon with accurate async projection
                        // (used by Street View and Pictometry — must be accurate)
                        projectToLatLon(mapPoint).then(latLonPoint => {
                            if (latLonPoint?.x !== undefined && latLonPoint?.y !== undefined &&
                                Math.abs(latLonPoint.y) <= 90 && Math.abs(latLonPoint.x) <= 180) {
                                setState(prev => ({
                                    ...prev,
                                    contextMenu: {
                                        ...prev.contextMenu,
                                        projectedLatLon: { lat: latLonPoint.y, lon: latLonPoint.x }
                                    }
                                }));
                            }
                        }).catch(() => { });

                        // Update coordinateLabel with accurate projection if needed
                        if (copySettings.coordinateSystem === 'webMercator') {
                            projectToLatLon(mapPoint).then(latLonPoint => {
                                if (latLonPoint?.x !== undefined && latLonPoint?.y !== undefined &&
                                    Math.abs(latLonPoint.y) <= 90 && Math.abs(latLonPoint.x) <= 180) {
                                    const newLabel = copySettings.coordinateFormat === 'dms'
                                        ? `${convertToDMS(latLonPoint.y, 'lat')}, ${convertToDMS(latLonPoint.x, 'lon')}`
                                        : `${latLonPoint.y.toFixed(copySettings.decimalPlaces || 6)}, ${latLonPoint.x.toFixed(copySettings.decimalPlaces || 6)}`;
                                    setState(prev => ({
                                        ...prev,
                                        contextMenu: { ...prev.contextMenu, coordinateLabel: newLabel }
                                    }));
                                }
                            }).catch(() => { });
                        } else if (copySettings.coordinateSystem === 'custom' && copySettings.customWkid) {
                            projectToSpatialReference(mapPoint, copySettings.customWkid).then(projectedPoint => {
                                const newLabel = `${projectedPoint.x.toFixed(copySettings.decimalPlaces || 2)}, ${projectedPoint.y.toFixed(copySettings.decimalPlaces || 2)}`;
                                setState(prev => ({
                                    ...prev,
                                    contextMenu: { ...prev.contextMenu, coordinateLabel: newLabel }
                                }));
                            }).catch(() => { });
                        }
                    }
                });

                mapView.on('click', (event) => {
                    // Always hide context menu on left click
                    if (event.button !== 2) {
                        hideContextMenu();
                    }
                });

                mapView.on('drag', hideContextMenu);
            }).catch(() => { });
        }
    }, [projectToLatLon, manualProjectToLatLon, projectToSpatialReference, convertToDMS, hideContextMenu, props.config?.copySettings]);

    // Build menu items array for keyboard navigation
    const getMenuItems = React.useCallback(() => {
        const items: Array<{ action: string; icon: string; text: string; enabled: boolean }> = [];

        if (props.config?.enabledActions?.zoomIn !== false) {
            items.push({ action: 'zoom-in', icon: '🔍', text: 'Zoom In', enabled: true });
        }
        if (props.config?.enabledActions?.zoomOut !== false) {
            items.push({ action: 'zoom-out', icon: '🔍', text: 'Zoom Out', enabled: true });
        }
        if (props.config?.enabledActions?.centerHere !== false) {
            items.push({ action: 'center-here', icon: '📍', text: 'Center Here', enabled: true });
        }
        if (props.config?.enabledActions?.plotMarker !== false) {
            items.push({ action: 'plot-marker', icon: '🔴', text: 'Plot Marker', enabled: true });
        }
        if (props.config?.enabledActions?.copyCoordinates !== false && state.contextMenu.coordinateLabel) {
            items.push({ action: 'get-coordinates', icon: '📋', text: `Copy Coordinates: ${state.contextMenu.coordinateLabel}`, enabled: true });
        }
        if (props.config?.enabledActions?.plotCoordinates !== false) {
            items.push({ action: 'plot-coordinates', icon: '📌', text: 'Plot Coordinate', enabled: true });
        }
        if (props.config?.enabledActions?.addText !== false) {
            items.push({ action: 'add-text', icon: '🅰️', text: 'Add Text', enabled: true });
        }
        if ((state.coordinateMarkers.length > 0 || state.simpleMarkers.length > 0 || state.textGraphics.length > 0) &&
            (props.config?.enabledActions?.plotCoordinates !== false || props.config?.enabledActions?.plotMarker !== false || props.config?.enabledActions?.addText !== false)) {
            const count = state.coordinateMarkers.length + state.simpleMarkers.length + state.textGraphics.length;
            items.push({ action: 'clear-all-graphics', icon: '🧹', text: `Clear All Graphics (${count})`, enabled: true });
        }
        if (props.config?.enabledActions?.streetView !== false) {
            items.push({ action: 'street-view', icon: '🗺️', text: 'Open in Google Street View', enabled: true });
        }
        if (props.config?.enabledActions?.pictometry !== false && props.config?.pictometryUrl) {
            items.push({ action: 'pictometry', icon: '📷', text: 'Open in Pictometry', enabled: true });
        }
        if (props.config?.enabledActions?.measureDistance !== false) {
            items.push({ action: 'measure-distance', icon: '📏', text: 'Measure Distance', enabled: true });
        }
        if (props.config?.enabledActions?.measureArea !== false) {
            items.push({ action: 'measure-area', icon: '📐', text: 'Measure Area', enabled: true });
        }
        if (props.config?.enabledActions?.whatsHere !== false) {
            items.push({ action: 'whats-here', icon: '❓', text: "What's here?", enabled: true });
        }
        if (props.config?.enabledActions?.propertyReport && props.config?.propertyReportSettings?.targetWidgetId) {
            const menuLabel = props.config.propertyReportSettings.menuLabel || 'Property Information';
            items.push({ action: 'property-report', icon: '🏠', text: menuLabel, enabled: true });
        }
        if (props.config?.enabledActions?.mailingLabels && props.config?.mailingLabelsSettings?.targetWidgetId) {
            const menuLabel = props.config.mailingLabelsSettings.menuLabel || 'Mailing Labels';
            items.push({ action: 'mailing-labels', icon: '✉️', text: menuLabel, enabled: true });
        }

        return items;
    }, [props.config?.enabledActions, props.config?.pictometryUrl, props.config?.propertyReportSettings?.targetWidgetId, props.config?.propertyReportSettings?.menuLabel, props.config?.mailingLabelsSettings?.targetWidgetId, props.config?.mailingLabelsSettings?.menuLabel, state.contextMenu.coordinateLabel, state.coordinateMarkers.length, state.simpleMarkers.length, state.textGraphics.length]);

    const menuItems = getMenuItems();

    // Handle keyboard navigation in context menu
    const handleMenuKeyDown = React.useCallback((e: React.KeyboardEvent) => {
        const items = menuItems;
        const currentIndex = state.focusedMenuIndex;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                setState(prev => ({ ...prev, focusedMenuIndex: nextIndex }));
                break;
            case 'ArrowUp':
                e.preventDefault();
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                setState(prev => ({ ...prev, focusedMenuIndex: prevIndex }));
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (currentIndex >= 0 && currentIndex < items.length) {
                    handleContextMenuAction(items[currentIndex].action);
                }
                break;
            case 'Escape':
                e.preventDefault();
                hideContextMenu();
                break;
            case 'Tab':
                e.preventDefault();
                hideContextMenu();
                break;
            case 'Home':
                e.preventDefault();
                setState(prev => ({ ...prev, focusedMenuIndex: 0 }));
                break;
            case 'End':
                e.preventDefault();
                setState(prev => ({ ...prev, focusedMenuIndex: items.length - 1 }));
                break;
        }
    }, [menuItems, state.focusedMenuIndex, handleContextMenuAction, hideContextMenu]);

    // Focus menu when it becomes visible
    React.useEffect(() => {
        if (state.contextMenu.visible && menuRef.current) {
            setState(prev => ({ ...prev, focusedMenuIndex: 0 }));
            menuRef.current.focus();
        }
    }, [state.contextMenu.visible]);

    // Focus trap for text dialog
    React.useEffect(() => {
        if (state.showTextDialog && textInputRef.current) {
            textInputRef.current.focus();
        }
    }, [state.showTextDialog]);

    // Focus the "Apply buffer" checkbox when the Mailing Labels dialog opens
    // so keyboard / screen-reader users land on the first interactive element.
    // From there they can Tab to the distance input and unit dropdown, or just
    // press Enter on the input field to submit.
    React.useEffect(() => {
        if (state.showMailingLabelsBufferDialog && mailingLabelsApplyBufferBtnRef.current) {
            mailingLabelsApplyBufferBtnRef.current.focus();
        }
    }, [state.showMailingLabelsBufferDialog]);

    const contextMenuStyle: React.CSSProperties = {
        position: 'fixed',
        top: state.contextMenu.y,
        left: state.contextMenu.x,
        backgroundColor: 'white',
        border: '1px solid #ccc',
        borderRadius: '4px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        zIndex: 2147483647,
        minWidth: '200px',
        display: state.contextMenu.visible ? 'block' : 'none',
        fontFamily: themeFont,
        outline: 'none'
    };

    const getMenuItemStyle = (index: number): React.CSSProperties => ({
        padding: '8px 12px',
        cursor: 'pointer',
        borderBottom: index < menuItems.length - 1 ? '1px solid #eee' : 'none',
        fontSize: '14px',
        backgroundColor: state.focusedMenuIndex === index ? '#e3f2fd' : 'transparent',
        outline: state.focusedMenuIndex === index ? '2px solid #1976d2' : 'none',
        outlineOffset: '-2px'
    });

    // Accessible MenuItem render function - NOT memoized to avoid stale closure issues
    const renderMenuItem = (action: string, icon: string, text: string, index: number) => (
        <div
            key={action}
            role="menuitem"
            tabIndex={state.focusedMenuIndex === index ? 0 : -1}
            style={getMenuItemStyle(index)}
            onMouseDown={(e) => {
                // Stop propagation AND prevent default to avoid document handler closing menu
                e.stopPropagation();
                e.preventDefault();
            }}
            onClick={(e) => {
                // Handle the action on click
                e.stopPropagation();
                e.preventDefault();
                handleContextMenuAction(action);
            }}
            onMouseEnter={() => setState(prev => ({ ...prev, focusedMenuIndex: index }))}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleContextMenuAction(action);
                }
            }}
            aria-label={text}
        >
            <span aria-hidden="true">{icon}</span> {text}
        </div>
    );

    // CSS styles using theme - this ensures proper font inheritance
    const getWidgetStyles = () => {
        return css`
            width: 100%;
            height: 100%;
            position: relative;
            font-family: ${themeFont};
            
            *, *::before, *::after {
                font-family: inherit;
            }
        `;
    };

    return (
        <div className="widget-right-click-map jimu-widget" css={getWidgetStyles()}>
            {mapWidgetIds?.length > 0 ? (
                <JimuMapViewComponent
                    useMapWidgetId={mapWidgetIds[0]}
                    onActiveViewChange={onActiveViewChange}
                />
            ) : (
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <p>Please configure this widget to use a Map widget.</p>
                    <p>Go to widget settings and select a map to connect to.</p>
                </div>
            )}

            {/* Accessible context menu */}
            <div
                id="context-menu"
                ref={menuRef}
                role="menu"
                aria-label="Map context menu"
                tabIndex={-1}
                style={contextMenuStyle}
                onKeyDown={handleMenuKeyDown}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
            >
                {menuItems.map((item, index) =>
                    renderMenuItem(item.action, item.icon, item.text, index)
                )}
            </div>

            {/* Live region for screen reader announcements */}
            <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                style={{
                    position: 'absolute',
                    width: '1px',
                    height: '1px',
                    padding: 0,
                    margin: '-1px',
                    overflow: 'hidden',
                    clip: 'rect(0, 0, 0, 0)',
                    whiteSpace: 'nowrap',
                    border: 0
                }}
            >
                {state.announceMessage}
            </div>

            {/* Accessible text input dialog */}
            {state.showTextDialog && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        zIndex: 2000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                    onClick={(e) => {
                        // Close on backdrop click
                        if (e.target === e.currentTarget) {
                            cancelTextInput();
                        }
                    }}
                    role="presentation"
                >
                    <div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="text-dialog-title"
                        aria-describedby="text-dialog-description"
                        style={{
                            backgroundColor: 'white',
                            borderRadius: '8px',
                            padding: '24px',
                            minWidth: '400px',
                            maxWidth: '500px',
                            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                            fontFamily: themeFont
                        }}
                        onKeyDown={(e) => {
                            // Focus trap - prevent Tab from leaving dialog
                            if (e.key === 'Tab') {
                                const focusableElements = dialogRef.current?.querySelectorAll(
                                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                                );
                                if (focusableElements && focusableElements.length > 0) {
                                    const firstElement = focusableElements[0] as HTMLElement;
                                    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

                                    if (e.shiftKey && document.activeElement === firstElement) {
                                        e.preventDefault();
                                        lastElement.focus();
                                    } else if (!e.shiftKey && document.activeElement === lastElement) {
                                        e.preventDefault();
                                        firstElement.focus();
                                    }
                                }
                            }
                            if (e.key === 'Escape') {
                                cancelTextInput();
                            }
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '16px',
                            paddingBottom: '12px',
                            borderBottom: '1px solid #e0e0e0'
                        }}>
                            <h2
                                id="text-dialog-title"
                                style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}
                            >
                                <span aria-hidden="true">🅰️ </span>Enter Your Text
                            </h2>
                            <button
                                onClick={cancelTextInput}
                                aria-label="Close dialog"
                                style={{
                                    background: 'none',
                                    border: '2px solid transparent',
                                    fontSize: '24px',
                                    cursor: 'pointer',
                                    color: '#555',
                                    padding: '4px',
                                    width: '36px',
                                    height: '36px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '4px'
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#1976d2'; e.currentTarget.style.outline = 'none'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                            >
                                <span aria-hidden="true">✕</span>
                            </button>
                        </div>
                        <p
                            id="text-dialog-description"
                            style={{
                                margin: '0 0 8px 0',
                                color: '#555',
                                fontSize: '14px',
                                fontFamily: themeFont,
                                lineHeight: '1.4'
                            }}
                        >
                            Type the text you want to add at this location on the map.
                        </p>
                        <label
                            htmlFor="map-text-input"
                            style={{
                                display: 'block',
                                marginBottom: '4px',
                                fontSize: '14px',
                                fontWeight: '500',
                                color: '#333'
                            }}
                        >
                            Text label
                        </label>
                        <input
                            ref={textInputRef}
                            id="map-text-input"
                            type="text"
                            placeholder="Enter text here"
                            aria-describedby="text-dialog-description"
                            style={{
                                width: '100%',
                                padding: '12px',
                                border: '2px solid #ccc',
                                borderRadius: '4px',
                                fontSize: '14px',
                                fontFamily: themeFont,
                                marginBottom: '20px',
                                boxSizing: 'border-box'
                            }}
                            onFocus={(e) => { e.currentTarget.style.borderColor = '#1976d2'; e.currentTarget.style.outline = 'none'; }}
                            onBlur={(e) => { e.currentTarget.style.borderColor = '#ccc'; }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    const target = e.target as HTMLInputElement;
                                    if (target.value.trim()) {
                                        addTextToMap(target.value);
                                    }
                                }
                            }}
                        />
                        <div style={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: '12px'
                        }}>
                            <button
                                onClick={cancelTextInput}
                                style={{
                                    padding: '10px 20px',
                                    border: '2px solid #555',
                                    borderRadius: '4px',
                                    backgroundColor: 'white',
                                    color: '#333',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontFamily: themeFont,
                                    fontWeight: '500'
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#1976d2'; e.currentTarget.style.outline = 'none'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = '#555'; }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    if (textInputRef.current && textInputRef.current.value.trim()) {
                                        addTextToMap(textInputRef.current.value);
                                    }
                                }}
                                style={{
                                    padding: '10px 20px',
                                    border: '2px solid #0066cc',
                                    borderRadius: '4px',
                                    backgroundColor: '#0066cc',
                                    color: 'white',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontFamily: themeFont,
                                    fontWeight: '500'
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#004499'; e.currentTarget.style.backgroundColor = '#004499'; e.currentTarget.style.outline = 'none'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = '#0066cc'; e.currentTarget.style.backgroundColor = '#0066cc'; }}
                            >
                                Add Text
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Mailing Labels buffer-choice dialog. Mirrors the text-input dialog
                for visual consistency; user picks "Yes" or "No" (or cancels) and
                launchMailingLabels handles the actual widget open. */}
            {state.showMailingLabelsBufferDialog && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        zIndex: 2000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            cancelMailingLabelsBufferDialog();
                        }
                    }}
                    role="presentation"
                >
                    <div
                        ref={mailingLabelsDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="mailing-labels-dialog-title"
                        aria-describedby="mailing-labels-dialog-description"
                        style={{
                            backgroundColor: 'white',
                            borderRadius: '8px',
                            padding: '24px',
                            minWidth: '400px',
                            maxWidth: '500px',
                            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                            fontFamily: themeFont
                        }}
                        onKeyDown={(e) => {
                            // Focus trap — keep Tab inside the dialog.
                            if (e.key === 'Tab') {
                                const focusableElements = mailingLabelsDialogRef.current?.querySelectorAll(
                                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                                );
                                if (focusableElements && focusableElements.length > 0) {
                                    const firstElement = focusableElements[0] as HTMLElement;
                                    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

                                    if (e.shiftKey && document.activeElement === firstElement) {
                                        e.preventDefault();
                                        lastElement.focus();
                                    } else if (!e.shiftKey && document.activeElement === lastElement) {
                                        e.preventDefault();
                                        firstElement.focus();
                                    }
                                }
                            }
                            if (e.key === 'Escape') {
                                cancelMailingLabelsBufferDialog();
                            }
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '16px',
                            paddingBottom: '12px',
                            borderBottom: '1px solid #e0e0e0'
                        }}>
                            <h2
                                id="mailing-labels-dialog-title"
                                style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}
                            >
                                <span aria-hidden="true">✉️ </span>Mailing Labels
                            </h2>
                            <button
                                onClick={cancelMailingLabelsBufferDialog}
                                aria-label="Close dialog"
                                style={{
                                    background: 'none',
                                    border: '2px solid transparent',
                                    fontSize: '24px',
                                    cursor: 'pointer',
                                    color: '#555',
                                    padding: '4px',
                                    width: '36px',
                                    height: '36px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '4px'
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#1976d2'; e.currentTarget.style.outline = 'none'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                            >
                                <span aria-hidden="true">✕</span>
                            </button>
                        </div>
                        <p
                            id="mailing-labels-dialog-description"
                            style={{
                                margin: '0 0 16px 0',
                                color: '#333',
                                fontSize: '14px',
                                fontFamily: themeFont,
                                lineHeight: '1.5'
                            }}
                        >
                            Would you like to apply a buffer to your selection? Tick the
                            box below and enter a distance to include all features within
                            that range of the right-clicked location.
                        </p>

                        {/* Apply-buffer toggle */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginBottom: '12px'
                        }}>
                            <input
                                ref={mailingLabelsApplyBufferBtnRef}
                                id="mailing-labels-apply-buffer"
                                type="checkbox"
                                checked={state.mailingLabelsBufferEnabled}
                                onChange={(e) => {
                                    const checked = e.target.checked;
                                    setState(prev => ({
                                        ...prev,
                                        mailingLabelsBufferEnabled: checked,
                                        // Clear any prior validation error when the checkbox is toggled
                                        mailingLabelsBufferError: ''
                                    }));
                                }}
                                style={{
                                    width: '18px',
                                    height: '18px',
                                    cursor: 'pointer',
                                    margin: 0
                                }}
                            />
                            <label
                                htmlFor="mailing-labels-apply-buffer"
                                style={{
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: '#333',
                                    cursor: 'pointer',
                                    userSelect: 'none'
                                }}
                            >
                                Apply a buffer to the selection
                            </label>
                        </div>

                        {/* Distance + unit inputs. Disabled (greyed out) when the
                            checkbox above is off, so the relationship between the
                            toggle and the inputs is visually obvious. */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginBottom: '8px',
                            opacity: state.mailingLabelsBufferEnabled ? 1 : 0.5
                        }}>
                            <label
                                htmlFor="mailing-labels-buffer-distance"
                                style={{
                                    fontSize: '14px',
                                    color: '#333',
                                    minWidth: '70px'
                                }}
                            >
                                Distance
                            </label>
                            <input
                                id="mailing-labels-buffer-distance"
                                type="number"
                                min={0}
                                step="any"
                                value={state.mailingLabelsBufferDistance}
                                disabled={!state.mailingLabelsBufferEnabled}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setState(prev => ({
                                        ...prev,
                                        mailingLabelsBufferDistance: v,
                                        // Clear stale error message once the user edits the value
                                        mailingLabelsBufferError: ''
                                    }));
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        launchMailingLabels();
                                    }
                                }}
                                style={{
                                    flex: '0 0 100px',
                                    padding: '8px 10px',
                                    border: '2px solid #ccc',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                    fontFamily: themeFont,
                                    boxSizing: 'border-box'
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#1976d2'; e.currentTarget.style.outline = 'none'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = '#ccc'; }}
                                aria-describedby={state.mailingLabelsBufferError ? 'mailing-labels-buffer-error' : undefined}
                            />
                            <label
                                htmlFor="mailing-labels-buffer-unit"
                                style={{
                                    position: 'absolute',
                                    width: '1px',
                                    height: '1px',
                                    padding: 0,
                                    margin: '-1px',
                                    overflow: 'hidden',
                                    clip: 'rect(0,0,0,0)',
                                    border: 0
                                }}
                            >
                                Buffer unit
                            </label>
                            <select
                                id="mailing-labels-buffer-unit"
                                value={state.mailingLabelsBufferUnit}
                                disabled={!state.mailingLabelsBufferEnabled}
                                onChange={(e) => {
                                    const v = e.target.value as 'feet' | 'meters' | 'kilometers' | 'miles';
                                    setState(prev => ({
                                        ...prev,
                                        mailingLabelsBufferUnit: v
                                    }));
                                }}
                                style={{
                                    flex: 1,
                                    padding: '8px 10px',
                                    border: '2px solid #ccc',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                    fontFamily: themeFont,
                                    backgroundColor: 'white',
                                    boxSizing: 'border-box'
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#1976d2'; e.currentTarget.style.outline = 'none'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = '#ccc'; }}
                            >
                                <option value="feet">feet</option>
                                <option value="meters">meters</option>
                                <option value="kilometers">kilometers</option>
                                <option value="miles">miles</option>
                            </select>
                        </div>

                        {/* Inline validation error. Only rendered when something
                            is wrong, so the dialog stays compact otherwise. */}
                        {state.mailingLabelsBufferError && (
                            <div
                                id="mailing-labels-buffer-error"
                                role="alert"
                                style={{
                                    color: '#b00020',
                                    fontSize: '13px',
                                    margin: '0 0 16px 0',
                                    lineHeight: '1.4'
                                }}
                            >
                                {state.mailingLabelsBufferError}
                            </div>
                        )}

                        <div style={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: '12px',
                            marginTop: state.mailingLabelsBufferError ? '4px' : '20px',
                            flexWrap: 'wrap'
                        }}>
                            <button
                                onClick={cancelMailingLabelsBufferDialog}
                                style={{
                                    padding: '10px 20px',
                                    border: '2px solid #555',
                                    borderRadius: '4px',
                                    backgroundColor: 'white',
                                    color: '#333',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontFamily: themeFont,
                                    fontWeight: '500'
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#1976d2'; e.currentTarget.style.outline = 'none'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = '#555'; }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => launchMailingLabels()}
                                style={{
                                    padding: '10px 20px',
                                    border: '2px solid #0066cc',
                                    borderRadius: '4px',
                                    backgroundColor: '#0066cc',
                                    color: 'white',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontFamily: themeFont,
                                    fontWeight: '500'
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#004499'; e.currentTarget.style.backgroundColor = '#004499'; e.currentTarget.style.outline = 'none'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = '#0066cc'; e.currentTarget.style.backgroundColor = '#0066cc'; }}
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default Widget;