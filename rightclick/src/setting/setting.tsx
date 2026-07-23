// @ts-nocheck -- editor noise suppression. Experience Builder 1.21 type packages moved and this widget is edited from folders without node_modules (GitHub mirror); type-level errors here are false positives. Webpack emits identical JavaScript with or without checking.
import { React, Immutable } from 'jimu-core';
import { AllWidgetSettingProps } from 'jimu-for-builder';
import { JimuMapViewComponent, JimuMapView } from 'jimu-arcgis';
import { MapWidgetSelector, SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components';
import { SymbolSelector, JimuSymbolType } from 'jimu-ui/advanced/map';
import { PlusOutlined } from 'jimu-icons/outlined/editor/plus';
import { TrashOutlined } from 'jimu-icons/outlined/editor/trash';
import { RefreshOutlined } from 'jimu-icons/outlined/editor/refresh';
import {
    Switch,
    Radio,
    TextInput,
    TextArea,
    Button,
    Select,
    Option,
    Icon,
    Tooltip,
    NumericInput,
    Alert,
    Checkbox,
    Loading
} from 'jimu-ui';
import { IMConfig, FeatureLayerConfig, PopupOverrideConfig, ArcadeExpressionInfo, WhatsHereLayerSelection, WhatsHereHighlightConfig, defaultWhatsHereHighlight, computeLayerSelectionKey } from '../config';

// Define the field interface
interface ServiceField {
    name: string;
    alias: string;
    type: string;
}

// Layer tree node used to render the developer-facing layer selection UI.
// Each node represents a single map layer (top-level or sublayer of a service
// layer or descendant of a group layer). Only nodes with `queryable === true`
// can actually be picked at runtime — non-queryable nodes (raster layers,
// group containers) act purely as tree scaffolding for cascade selection.
interface LayerTreeNode {
    key: string;                  // selection key (matches computeLayerSelectionKey at runtime)
    title: string;
    queryable: boolean;
    isGroup: boolean;             // GroupLayer or service container (MapImageLayer) — has children, not selectable on its own
    children: LayerTreeNode[];
}

// Recursive tree node for the layer-selection UI. Renders a row with a
// tri-state checkbox (all / some / none of descendant leaves selected),
// the layer title, and any children indented below. Cascade toggling and
// the tri-state computation are driven by helpers passed down as props so
// the component stays purely presentational.
interface LayerSelectionTreeNodeProps {
    // React's list key. React consumes this before the component sees it,
    // but callers pass it inside the same props object, so it has to exist
    // on the type for the JSX to type-check.
    key?: string;
    node: LayerTreeNode;
    depth: number;
    getNodeState: (node: LayerTreeNode) => 'all' | 'some' | 'none';
    isLayerSelected: (key: string) => boolean;
    onToggle: (node: LayerTreeNode, checked: boolean) => void;
    collectLeafKeysUnder: (node: LayerTreeNode) => string[];
    // Trust toggle — group/service nodes only. When ON, every current
    // and future nested layer is auto-included at runtime.
    isTrusted: (node: LayerTreeNode) => boolean;
    onTrustToggle: (node: LayerTreeNode, trusted: boolean) => void;
}

const LayerSelectionTreeNode = (p: LayerSelectionTreeNodeProps) => {
    const [collapsed, setCollapsed] = React.useState<boolean>(false);
    const hasChildren = p.node.children && p.node.children.length > 0;
    const state = p.getNodeState(p.node);
    const checked = state === 'all';
    const indeterminate = state === 'some';
    const leafCount = p.collectLeafKeysUnder(p.node).length;

    // Layout constants. INDENT is the per-depth horizontal step; ARROW_W is
    // the fixed reserved width for the expand/collapse glyph so checkboxes
    // line up perfectly across sibling rows (regardless of whether a row is
    // a group with an arrow or a leaf with an empty placeholder).
    const INDENT = 18;
    const ARROW_W = 16;

    return (
        <div role="treeitem" aria-expanded={hasChildren ? !collapsed : undefined}>
            {/* Row */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    paddingLeft: `${p.depth * INDENT}px`,
                    minHeight: '26px',
                    fontSize: '12px',
                    lineHeight: '1.3'
                }}
            >
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={() => setCollapsed(c => !c)}
                        aria-label={collapsed ? 'Expand' : 'Collapse'}
                        style={{
                            width: `${ARROW_W}px`,
                            height: '20px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            // `currentColor` inherits the row's text color so the
                            // arrow is always visible in light *and* dark themes.
                            color: 'currentColor',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: 0,
                            margin: 0,
                            flexShrink: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: 0.75
                        }}
                    >
                        {collapsed ? '▶' : '▼'}
                    </button>
                ) : (
                    <span style={{ width: `${ARROW_W}px`, flexShrink: 0 }} aria-hidden="true" />
                )}

                <label
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        margin: 0,
                        flex: 1,
                        minWidth: 0,
                        cursor: 'pointer'
                    }}
                >
                    <Checkbox
                        checked={checked}
                        indeterminate={indeterminate}
                        onChange={(e: any) => p.onToggle(p.node, e.target?.checked ?? !checked)}
                    />
                    <span
                        style={{
                            flex: 1,
                            minWidth: 0,
                            fontWeight: hasChildren ? 600 : 400,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }}
                        title={p.node.title}
                    >
                        {p.node.title}
                    </span>
                    {hasChildren && (
                        <span style={{ fontSize: '11px', opacity: 0.6, flexShrink: 0, whiteSpace: 'nowrap' }}>
                            ({leafCount})
                        </span>
                    )}
                </label>

                {/* Trust toggle — group / map-service rows only. When ON, every
                    nested layer (including ones added later) is auto-included
                    at runtime without needing to re-tick anything. */}
                {hasChildren && (() => {
                    const trusted = p.isTrusted(p.node);
                    return (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                p.onTrustToggle(p.node, !trusted);
                            }}
                            title={
                                trusted
                                    ? 'Trusted: every nested layer (current + future) is included automatically. Click to un-trust.'
                                    : 'Click to trust this group — every nested layer (current + future) will be auto-included in What\u2019s Here.'
                            }
                            style={{
                                flexShrink: 0,
                                marginLeft: '4px',
                                padding: '1px 8px',
                                fontSize: '10px',
                                fontWeight: 600,
                                lineHeight: '16px',
                                borderRadius: '10px',
                                border: trusted ? '1px solid #2e7d32' : '1px solid currentColor',
                                background: trusted ? '#2e7d32' : 'transparent',
                                color: trusted ? '#fff' : 'currentColor',
                                opacity: trusted ? 1 : 0.55,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {trusted ? '🔒 Trusted' : 'Trust'}
                        </button>
                    );
                })()}
            </div>

            {/* Children container with a vertical guide line drawn underneath
                the parent's expand arrow — makes nesting obvious at a glance
                in both light and dark themes. */}
            {hasChildren && !collapsed && (
                <div role="group" style={{ position: 'relative' }}>
                    <span
                        aria-hidden="true"
                        style={{
                            position: 'absolute',
                            // align under the centre of the parent's arrow glyph
                            left: `${p.depth * INDENT + Math.floor(ARROW_W / 2)}px`,
                            top: 0,
                            bottom: '12px',
                            width: '1px',
                            background: 'currentColor',
                            opacity: 0.18,
                            pointerEvents: 'none'
                        }}
                    />
                    {p.node.children.map(child => (
                        <LayerSelectionTreeNode
                            key={child.key}
                            node={child}
                            depth={p.depth + 1}
                            getNodeState={p.getNodeState}
                            isLayerSelected={p.isLayerSelected}
                            onToggle={p.onToggle}
                            collectLeafKeysUnder={p.collectLeafKeysUnder}
                            isTrusted={p.isTrusted}
                            onTrustToggle={p.onTrustToggle}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── Config XML serialization ────────────────────────────────────────────
// Used by the Import/Export Configuration section in the settings panel.
// The serializer walks the live config object recursively and emits a
// human-readable XML document; the parser walks it back into a plain JS
// object that can be wrapped in Immutable() and committed via
// onSettingChange.
//
// The schema is intentionally generic — instead of listing every field by
// hand (the rightclick config has dozens of nested sub-objects and will
// grow), we encode primitives with a `type="..."` attribute and let
// recursion handle the rest. Strings need no type attribute (default).
// This means any future config field added in config.ts will be captured
// by export and round-tripped by import without touching this code.

const RIGHTCLICK_CONFIG_ROOT_TAG = 'RightClickConfig';

const escapeXmlText = (str: string): string =>
    String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

// XML element names must start with a letter or underscore and contain
// only letters, digits, hyphens, underscores, and periods. Config keys
// are already JS identifiers so they're always safe, but sanitize
// defensively in case a user adds something unusual.
const sanitizeXmlTagName = (name: string): string => {
    let s = String(name).replace(/[^A-Za-z0-9_\-.]/g, '_');
    if (!/^[A-Za-z_]/.test(s)) s = '_' + s;
    return s;
};

// Convert an Immutable / plain config object into a plain JS structure
// the serializer can walk. asMutable({ deep: true }) handles jimu's
// seamless-immutable wrapping; the JSON round-trip is a fallback for
// anything that's already a plain object.
const configToPlainJs = (cfg: any): any => {
    if (cfg == null) return {};
    if (typeof cfg.asMutable === 'function') {
        try { return cfg.asMutable({ deep: true }); } catch (_) { /* fall through */ }
    }
    try { return JSON.parse(JSON.stringify(cfg)); } catch (_) { return cfg; }
};

const emitXmlNode = (tag: string, value: any, depth: number): string => {
    const indent = '  '.repeat(depth);
    const safeTag = sanitizeXmlTagName(tag);

    if (value === undefined) return '';            // skip undefined entirely
    if (value === null) return `${indent}<${safeTag} null="true"/>\n`;

    if (typeof value === 'string') {
        if (value.length === 0) return `${indent}<${safeTag}/>\n`;
        // Use CDATA for multi-line / HTML-ish content (Arcade source,
        // popup content templates) so the user sees the original text
        // exactly. Escape the CDATA terminator if it appears in the value.
        if (value.indexOf('\n') !== -1 || value.indexOf('<') !== -1 || value.indexOf('&') !== -1) {
            const safe = value.replace(/]]>/g, ']]]]><![CDATA[>');
            return `${indent}<${safeTag}><![CDATA[${safe}]]></${safeTag}>\n`;
        }
        return `${indent}<${safeTag}>${escapeXmlText(value)}</${safeTag}>\n`;
    }
    if (typeof value === 'number') {
        return `${indent}<${safeTag} type="number">${value}</${safeTag}>\n`;
    }
    if (typeof value === 'boolean') {
        return `${indent}<${safeTag} type="boolean">${value}</${safeTag}>\n`;
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return `${indent}<${safeTag} type="array"/>\n`;
        let s = `${indent}<${safeTag} type="array">\n`;
        for (const item of value) s += emitXmlNode('item', item, depth + 1);
        s += `${indent}</${safeTag}>\n`;
        return s;
    }
    if (typeof value === 'object') {
        const keys = Object.keys(value).filter(k => value[k] !== undefined);
        if (keys.length === 0) return `${indent}<${safeTag}/>\n`;
        let s = `${indent}<${safeTag}>\n`;
        for (const k of keys) s += emitXmlNode(k, value[k], depth + 1);
        s += `${indent}</${safeTag}>\n`;
        return s;
    }
    return `${indent}<${safeTag}>${escapeXmlText(String(value))}</${safeTag}>\n`;
};

const serializeConfigToXml = (cfg: any): string => {
    const plain = configToPlainJs(cfg);
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += emitXmlNode(RIGHTCLICK_CONFIG_ROOT_TAG, plain, 0);
    return xml;
};

const parseXmlElement = (el: Element): any => {
    if (el.getAttribute('null') === 'true') return null;
    const type = el.getAttribute('type');

    if (type === 'number') {
        const n = Number(el.textContent || '0');
        return Number.isFinite(n) ? n : 0;
    }
    if (type === 'boolean') {
        return (el.textContent || '').trim() === 'true';
    }
    if (type === 'array') {
        const items: any[] = [];
        for (let i = 0; i < el.children.length; i++) {
            items.push(parseXmlElement(el.children[i]));
        }
        return items;
    }

    // No explicit type: if there are element children, it's an object;
    // otherwise it's a string (or empty).
    if (el.children.length > 0) {
        const obj: Record<string, any> = {};
        for (let i = 0; i < el.children.length; i++) {
            const child = el.children[i];
            obj[child.tagName] = parseXmlElement(child);
        }
        return obj;
    }
    return el.textContent || '';
};

const parseXmlToConfig = (xmlStr: string): any => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error('Invalid XML — the document is not well-formed');
    }
    const root = doc.documentElement;
    if (!root || root.tagName !== RIGHTCLICK_CONFIG_ROOT_TAG) {
        throw new Error(`Expected root element <${RIGHTCLICK_CONFIG_ROOT_TAG}>, got <${root?.tagName ?? 'unknown'}>`);
    }
    return parseXmlElement(root);
};

const Setting = (props: AllWidgetSettingProps<IMConfig>) => {
    const { config } = props;

    // State for managing field loading
    const [fieldStates, setFieldStates] = React.useState<{
        [index: number]: {
            fields: ServiceField[];
            loading: boolean;
            error: string | null;
        }
    }>({});

    // State for the Import/Export Configuration section. Generated XML is
    // shown in a read-only textarea so the user can review before download.
    // Import accepts either a pasted string or a file (.xml) read via
    // FileReader. importError / importSuccess drive inline Alerts.
    const [exportXml, setExportXml] = React.useState<string>('');
    const [importXml, setImportXml] = React.useState<string>('');
    const [importError, setImportError] = React.useState<string | null>(null);
    const [importSuccess, setImportSuccess] = React.useState<boolean>(false);
    const importFileInputRef = React.useRef<HTMLInputElement>(null);
    const defaultEnabledActions = {
        zoomIn: true,
        zoomOut: true,
        centerHere: true,
        copyCoordinates: true,
        plotCoordinates: true,
        plotMarker: true,
        addText: true,
        streetView: true,
        pictometry: true,
        measureDistance: true,
        measureArea: true,
        whatsHere: true,
        propertyReport: false,
        mailingLabels: false
    };

    const defaultMeasurementSettings = {
        defaultUnits: 'feet' as const,
        unitDisplay: 'single' as const
    };

    const defaultLongPressSettings = {
        enabled: true,
        durationMs: 500,
        moveThresholdPx: 10
    };

    const defaultMarkerSettings = {
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

    const defaultPlotSettings = {
        markerSize: 12,
        markerColor: '#ff6b6b',
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

    const defaultTextSettings = {
        fontSize: 14,
        fontColor: '#000000',
        fontFamily: 'Arial',
        fontWeight: 'bold',
        haloColor: '#ffffff',
        haloSize: 2,
        backgroundColor: 'transparent',
        backgroundOpacity: 0.8
    };

    const enabledActions = React.useMemo(() =>
        ({ ...defaultEnabledActions, ...config.enabledActions }),
        [config.enabledActions]
    );

    const measurementSettings = React.useMemo(() =>
        ({ ...defaultMeasurementSettings, ...config.measurementSettings }),
        [config.measurementSettings]
    );

    const longPressSettings = React.useMemo(() =>
        ({ ...defaultLongPressSettings, ...config.longPressSettings }),
        [config.longPressSettings]
    );

    const plotSettings = React.useMemo(() =>
        ({ ...defaultPlotSettings, ...config.plotSettings }),
        [config.plotSettings]
    );

    const markerSettings = React.useMemo(() =>
        ({ ...defaultMarkerSettings, ...config.markerSettings }),
        [config.markerSettings]
    );

    const textSettings = React.useMemo(() =>
        ({ ...defaultTextSettings, ...config.textSettings }),
        [config.textSettings]
    );

    const defaultCopySettings = {
        coordinateSystem: 'map',
        customWkid: undefined,
        coordinateFormat: 'decimal',
        decimalPlaces: 2
    };

    const copySettings = React.useMemo(() =>
        ({ ...defaultCopySettings, ...config.copySettings }),
        [config.copySettings]
    );

    // Helper function to check if measurement actions are enabled
    const isMeasurementEnabled = React.useMemo(() =>
        enabledActions.measureDistance || enabledActions.measureArea,
        [enabledActions.measureDistance, enabledActions.measureArea]
    );

    // In ExB developer edition builder mode, the appConfig.widgets in the store
    // only contains builder framework widgets. The actual user-placed widgets
    // are in the experience's config file on disk. We provide a text input
    // and a helper button to scan the app config for property-report widgets.
    //
    // Each detected widget carries its URI so the dropdowns elsewhere in this
    // settings panel can distinguish "container" widgets (widget controllers
    // and accordion layouts) from regular widgets without a second lookup.
    const [detectedWidgets, setDetectedWidgets] = React.useState<Array<{ id: string; label: string; uri?: string }>>([]);
    const [scanning, setScanning] = React.useState(false);

    const scanForPropertyReportWidgets = React.useCallback(async () => {
        setScanning(true);
        try {
            // Parse app ID from URL - ExB dev edition uses ?id=N or /experience/N/
            const url = new URL(window.location.href);
            let appId = url.searchParams.get('id');
            if (!appId) {
                const pathMatch = window.location.href.match(/experience\/(\d+)/);
                appId = pathMatch ? pathMatch[1] : null;
            }
            if (!appId) {
                alert('Could not determine app ID from URL. Please enter the widget ID manually.');
                setScanning(false);
                return;
            }

            // ExB developer edition serves apps from server/public/apps/{id}/
            const baseUrl = window.location.origin;
            const possiblePaths = [
                `${baseUrl}/apps/${appId}/config.json`,
                `/apps/${appId}/config.json`,
            ];

            let appConfigData: any = null;

            for (const path of possiblePaths) {
                try {
                    const resp = await fetch(path);
                    if (resp.ok) {
                        const text = await resp.text();
                        try {
                            const data = JSON.parse(text);
                            if (data.widgets) {
                                appConfigData = data;
                                break;
                            }
                        } catch { /* not valid JSON */ }
                    }
                } catch { /* try next */ }
            }

            if (appConfigData?.widgets) {
                // Show all user widgets sorted alphabetically, with each
                // widget's URI included so the container-type dropdowns can
                // tell controllers / accordions apart from regular widgets.
                const allWidgets = Object.entries(appConfigData.widgets)
                    .map(([id, w]: [string, any]) => ({
                        id,
                        label: w.label || id,
                        uri: (w.uri || '') as string
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label));
                setDetectedWidgets(allWidgets);
            } else {
                console.warn('Right-Click Scan: Could not load config.json');
                alert('Could not load app config. Please enter the widget ID manually.\n\nYour config is at: server/public/apps/' + appId + '/config.json\nSearch for "property-report" to find the widget ID.');
            }
        } catch (e) {
            console.warn('Right-Click Scan: Error', e);
        }
        setScanning(false);
    }, []);

    // Classify a widget's URI as 'controller', 'accordion', or 'other'.
    // Used by the Property Report / Mailing Labels parent-container dropdowns
    // to filter the candidate list AND to display a small badge so the dev
    // can tell at a glance whether a candidate is a controller or an
    // accordion. Match is case-insensitive and tolerant of trailing
    // slashes / version segments.
    const classifyContainerUri = (uri?: string): 'controller' | 'accordion' | 'other' => {
        const u = (uri || '').toLowerCase();
        if (u.indexOf('common/controller') >= 0) return 'controller';
        if (u.indexOf('layout/accordion') >= 0 || u.indexOf('/accordion/') >= 0 || u.endsWith('/accordion')) return 'accordion';
        return 'other';
    };

    // List of container-capable widgets (controllers + accordions). Used to
    // populate the "Parent Container" dropdowns. Falls back to widgets whose
    // label hints at controller/accordion if URIs weren't captured (older
    // scans), so the UI still works on partially-populated state.
    const containerWidgets = React.useMemo(() => {
        return detectedWidgets.filter(w => {
            const cls = classifyContainerUri(w.uri);
            if (cls === 'controller' || cls === 'accordion') return true;
            const lbl = (w.label || '').toLowerCase();
            return lbl.includes('controller') || lbl.includes('accordion');
        });
    }, [detectedWidgets]);

    // Function to fetch fields from Feature Service
    const fetchFieldsFromService = async (url: string, layerIndex: number) => {
        if (!url.trim()) return;

        setFieldStates(prev => ({
            ...prev,
            [layerIndex]: { fields: [], loading: true, error: null }
        }));

        try {
            let serviceUrl = url.trim();
            if (!serviceUrl.includes('?')) {
                serviceUrl += '?f=json';
            } else if (!serviceUrl.includes('f=json')) {
                serviceUrl += '&f=json';
            }

            const response = await fetch(serviceUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message || 'Service returned an error');
            }

            if (!data.fields || !Array.isArray(data.fields)) {
                throw new Error('No fields found in service response');
            }

            const serviceFields: ServiceField[] = data.fields.map((field: any) => ({
                name: field.name,
                alias: field.alias || field.name,
                type: field.type
            }));

            setFieldStates(prev => ({
                ...prev,
                [layerIndex]: { fields: serviceFields, loading: false, error: null }
            }));

        } catch (error) {
            console.error('Error fetching fields:', error);
            setFieldStates(prev => ({
                ...prev,
                [layerIndex]: {
                    fields: [],
                    loading: false,
                    error: error.message || 'Failed to fetch fields from service'
                }
            }));
        }
    };

    // ─── Import / Export Configuration handlers ─────────────────────────────

    // Build the XML and stash it in state so the textarea renders it; the
    // user can review and copy/download from there.
    const handleGenerateExport = () => {
        const xml = serializeConfigToXml(config);
        setExportXml(xml);
    };

    const handleCopyExport = () => {
        const xml = exportXml || serializeConfigToXml(config);
        if (!exportXml) setExportXml(xml);
        try {
            if (navigator?.clipboard?.writeText) {
                navigator.clipboard.writeText(xml);
            }
        } catch (_) { /* clipboard may be blocked by browser policy — silent */ }
    };

    // Generate fresh XML for the download even if the user hasn't clicked
    // "Generate XML" first — convenience.
    const handleDownloadExport = () => {
        const xml = serializeConfigToXml(config);
        try {
            const blob = new Blob([xml], { type: 'application/xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Timestamped filename so multiple exports don't collide.
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            a.download = `rightclick-config-${ts}.xml`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            // Surface the error in the export textarea so the user sees
            // something concrete instead of a silent failure.
            setExportXml(`<!-- Download failed: ${(err as any)?.message || 'unknown error'} -->\n${xml}`);
        }
    };

    const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            setImportXml(text || '');
            setImportError(null);
            setImportSuccess(false);
        };
        reader.onerror = () => {
            setImportError('Failed to read the selected file.');
        };
        reader.readAsText(file);
        // Clear the input so selecting the same file twice still fires onChange.
        if (importFileInputRef.current) importFileInputRef.current.value = '';
    };

    const handleImport = () => {
        setImportError(null);
        setImportSuccess(false);

        const text = importXml.trim();
        if (!text) {
            setImportError('Paste XML, or load a configuration file first.');
            return;
        }

        let parsed: any;
        try {
            parsed = parseXmlToConfig(text);
        } catch (err: any) {
            setImportError(err?.message || 'Failed to parse XML.');
            return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            setImportError('Imported XML did not contain a configuration object.');
            return;
        }

        // Preserve environment-specific keys that shouldn't transfer across
        // Experiences:
        //   - useMapWidgetIds: tied to *this* Experience's map widget ids;
        //     replacing it would unbind the widget from the map.
        // Everything else (popup overrides, layer selection, plot styles,
        // measurement defaults, etc.) is portable and is overwritten.
        const currentMapWidgetIds = (config as any)?.useMapWidgetIds;
        const preservedMapWidgetIds =
            currentMapWidgetIds && typeof currentMapWidgetIds.asMutable === 'function'
                ? currentMapWidgetIds.asMutable()
                : (Array.isArray(currentMapWidgetIds) ? [...currentMapWidgetIds] : []);
        parsed.useMapWidgetIds = preservedMapWidgetIds;

        try {
            props.onSettingChange({
                id: (props as any).id,
                config: Immutable(parsed) as any
            });
        } catch (err: any) {
            setImportError(err?.message || 'Failed to apply the imported configuration.');
            return;
        }

        setImportSuccess(true);
        setImportXml('');
        // Auto-clear the success message after a few seconds so it doesn't
        // linger.
        setTimeout(() => setImportSuccess(false), 4000);
    };

    const onMapWidgetSelected = (useMapWidgetIds: string[]) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                useMapWidgetIds: Immutable(useMapWidgetIds)
            })
        });
    };

    const updateEnabledAction = (action: string, value: boolean) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                enabledActions: {
                    ...enabledActions,
                    [action]: value
                }
            })
        });
    };

    const updateCoordinateSystem = (value: 'map' | 'webMercator') => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                coordinateSystem: value
            })
        });
    };

    const updateMeasurementSetting = (property: keyof typeof measurementSettings, value: any) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                measurementSettings: {
                    ...measurementSettings,
                    [property]: value
                }
            })
        });
    };

    const updateLongPressSetting = (property: keyof typeof longPressSettings, value: any) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                longPressSettings: {
                    ...longPressSettings,
                    [property]: value
                }
            })
        });
    };

    const updatePlotSetting = (property: keyof typeof plotSettings, value: any) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                plotSettings: {
                    ...plotSettings,
                    [property]: value
                }
            })
        });
    };

    const updateMarkerSetting = (property: keyof typeof markerSettings, value: any) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                markerSettings: {
                    ...markerSettings,
                    [property]: value
                }
            })
        });
    };

    const updateTextSetting = (property: keyof typeof textSettings, value: any) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                textSettings: {
                    ...textSettings,
                    [property]: value
                }
            })
        });
    };

    const updateCopySetting = (property: keyof typeof copySettings, value: any) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                copySettings: {
                    ...copySettings,
                    [property]: value
                }
            })
        });
    };

    const updateWhatsHereUrl = (value: string) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                reverseGeocodeUrl: value
            })
        });
    };

    const updateReverseGeocodeWkid = (value: string) => {
        const wkid = parseInt(value, 10);
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                reverseGeocodeWkid: isNaN(wkid) ? undefined : wkid
            })
        });
    };

    const updatePictometryUrl = (value: string) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                pictometryUrl: value
            })
        });
    };

    const updatePropertyReportSetting = (property: string, value: any) => {
        const currentSettings = config.propertyReportSettings || {};
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                propertyReportSettings: {
                    ...currentSettings,
                    [property]: value
                }
            })
        });
    };

    // Update several propertyReportSettings fields in a single onSettingChange
    // call. Two sequential single-field updates race because each reads
    // `config` from the closure, which doesn't update synchronously after
    // onSettingChange — so the second update would overwrite the first.
    const updatePropertyReportSettings = (patch: Record<string, any>) => {
        const currentSettings = config.propertyReportSettings || {};
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                propertyReportSettings: {
                    ...currentSettings,
                    ...patch
                }
            })
        });
    };

    const updateMailingLabelsSetting = (property: string, value: any) => {
        const currentSettings = config.mailingLabelsSettings || {};
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                mailingLabelsSettings: {
                    ...currentSettings,
                    [property]: value
                }
            })
        });
    };

    const updateMailingLabelsSettings = (patch: Record<string, any>) => {
        const currentSettings = config.mailingLabelsSettings || {};
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                mailingLabelsSettings: {
                    ...currentSettings,
                    ...patch
                }
            })
        });
    };

    const updateFeatureLayer = (index: number, layer: FeatureLayerConfig) => {
        const updated = [...(config.featureLayers || [])];
        updated[index] = layer;
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({ ...config, featureLayers: updated })
        });
    };

    const addFeatureLayer = () => {
        const newLayer: FeatureLayerConfig = {
            name: '',
            url: '',
            fields: []
        };
        const updated = [...(config.featureLayers || []), newLayer];
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({ ...config, featureLayers: updated })
        });
    };

    const removeFeatureLayer = (index: number) => {
        const updated = [...(config.featureLayers || [])];
        updated.splice(index, 1);
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({ ...config, featureLayers: updated })
        });

        setFieldStates(prev => {
            const newState = { ...prev };
            delete newState[index];
            return newState;
        });
    };

    const updateWhatsHereSettings = (property: string, value: any) => {
        const whatsHereSettings = config.whatsHereSettings || {};
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                whatsHereSettings: {
                    ...whatsHereSettings,
                    [property]: value
                }
            })
        });
    };

    const updateUISettings = (property: string, value: any) => {
        const uiSettings = config.uiSettings || {};
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                uiSettings: {
                    ...uiSettings,
                    [property]: value
                }
            })
        });
    };

    const updateWhatsHereHighlight = (property: keyof WhatsHereHighlightConfig, value: any) => {
        const current = (config.whatsHereHighlight as any) || defaultWhatsHereHighlight;
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({
                ...config,
                whatsHereHighlight: {
                    ...current,
                    [property]: value
                }
            })
        });
    };

    // ─── Popup override helpers (Arcade-driven) ──────────────────────────────
    const generateOverrideId = (): string => {
        return `ovr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    };

    const updatePopupOverrides = (next: PopupOverrideConfig[]) => {
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({ ...config, popupOverrides: next })
        });
    };

    const addPopupOverride = () => {
        const current: PopupOverrideConfig[] = (config.popupOverrides as any) || [];
        const next: PopupOverrideConfig = {
            id: generateOverrideId(),
            enabled: true,
            matchUrl: '',
            matchTitle: '',
            title: '',
            content: '<div style="padding:4px 0;">\n  <!-- HTML with placeholders. Examples:\n       {NAME}                         field value (HTML-escaped)\n       {expression/myCalc}            Arcade result (raw HTML)\n  -->\n  <p><strong>{NAME}</strong></p>\n</div>',
            expressionInfos: []
        };
        updatePopupOverrides([...current, next]);
    };

    const updatePopupOverride = (index: number, patch: Partial<PopupOverrideConfig>) => {
        const current: PopupOverrideConfig[] = ((config.popupOverrides as any) || []).slice();
        if (!current[index]) return;
        current[index] = { ...current[index], ...patch };
        updatePopupOverrides(current);
    };

    const removePopupOverride = (index: number) => {
        const current: PopupOverrideConfig[] = ((config.popupOverrides as any) || []).slice();
        current.splice(index, 1);
        updatePopupOverrides(current);
    };

    const addOverrideExpression = (overrideIndex: number) => {
        const current: PopupOverrideConfig[] = ((config.popupOverrides as any) || []).slice();
        if (!current[overrideIndex]) return;
        const exprs: ArcadeExpressionInfo[] = (current[overrideIndex].expressionInfos || []).slice();
        const usedNames = new Set(exprs.map(e => e?.name).filter(Boolean));
        let n = exprs.length + 1;
        let proposed = `expr${n}`;
        while (usedNames.has(proposed)) { n++; proposed = `expr${n}`; }
        exprs.push({ name: proposed, title: '', expression: '// return something\nreturn $feature.OBJECTID;', returnType: 'string' });
        current[overrideIndex] = { ...current[overrideIndex], expressionInfos: exprs };
        updatePopupOverrides(current);
    };

    const updateOverrideExpression = (overrideIndex: number, exprIndex: number, patch: Partial<ArcadeExpressionInfo>) => {
        const current: PopupOverrideConfig[] = ((config.popupOverrides as any) || []).slice();
        if (!current[overrideIndex]) return;
        const exprs: ArcadeExpressionInfo[] = (current[overrideIndex].expressionInfos || []).slice();
        if (!exprs[exprIndex]) return;
        exprs[exprIndex] = { ...exprs[exprIndex], ...patch };
        current[overrideIndex] = { ...current[overrideIndex], expressionInfos: exprs };
        updatePopupOverrides(current);
    };

    const removeOverrideExpression = (overrideIndex: number, exprIndex: number) => {
        const current: PopupOverrideConfig[] = ((config.popupOverrides as any) || []).slice();
        if (!current[overrideIndex]) return;
        const exprs: ArcadeExpressionInfo[] = (current[overrideIndex].expressionInfos || []).slice();
        exprs.splice(exprIndex, 1);
        current[overrideIndex] = { ...current[overrideIndex], expressionInfos: exprs };
        updatePopupOverrides(current);
    };

    // ─── Layer-selection tree state + helpers ────────────────────────────────
    // The developer picks which layers feed What's Here via a checkbox tree
    // built from the live map's actual layer hierarchy (top-level layers,
    // group layer descendants, and MapImageLayer sublayers).
    const [layerTree, setLayerTree] = React.useState<LayerTreeNode[]>([]);
    const [allLeafKeys, setAllLeafKeys] = React.useState<string[]>([]);
    const [layerTreeReady, setLayerTreeReady] = React.useState<boolean>(false);

    // Build the layer tree from a live MapView. Mirrors the walk in widget.tsx
    // exactly so the selection keys line up at runtime.
    const buildLayerTree = React.useCallback((view: __esri.MapView): { tree: LayerTreeNode[]; leafKeys: string[] } => {
        const leafKeys: string[] = [];

        const buildNode = (lyr: any, depth: number): LayerTreeNode | null => {
            if (!lyr || depth > 20) return null;

            const lyrType = String(lyr.type || '').toLowerCase();
            const lyrCls = String(lyr.declaredClass || '');
            const queryable = typeof lyr.queryFeatures === 'function';
            const isGroup =
                lyrType === 'group' ||
                lyrCls.indexOf('GroupLayer') >= 0;
            const isMapImageLike =
                lyrType === 'map-image' ||
                lyrType === 'tile' ||
                lyrType === 'imagery-tile' ||
                lyrCls.indexOf('MapImageLayer') >= 0 ||
                lyrCls.indexOf('TileLayer') >= 0;

            const children: LayerTreeNode[] = [];

            // GroupLayer children
            const groupChildren = lyr?.layers?.items;
            if (Array.isArray(groupChildren)) {
                for (const c of groupChildren) {
                    const node = buildNode(c, depth + 1);
                    if (node) children.push(node);
                }
            }

            // MapImageLayer / TileLayer sublayers (flat list — already includes
            // descendants of internal group sublayers).
            const subs = lyr?.allSublayers?.items;
            if (Array.isArray(subs)) {
                for (const sub of subs) {
                    // Skip group-only sublayers (no queryFeatures, no useful
                    // sublayer-of-sublayer expansion because allSublayers is flat).
                    if (typeof sub?.queryFeatures !== 'function') continue;
                    const subKey = computeLayerSelectionKey(sub);
                    leafKeys.push(subKey);
                    children.push({
                        key: subKey,
                        title: sub.title || `Sublayer ${sub.id}`,
                        queryable: true,
                        isGroup: false,
                        children: []
                    });
                }
            }

            const key = computeLayerSelectionKey(lyr);

            // Decide whether this node itself counts as a "leaf" (selectable
            // queryable layer). Groups and map-service containers are NEVER
            // leaves themselves — only their queryable descendants are.
            if (queryable && !isGroup && !isMapImageLike) {
                leafKeys.push(key);
            }

            return {
                key,
                title: lyr.title || lyr.id || 'Layer',
                queryable: queryable && !isGroup && !isMapImageLike,
                isGroup: isGroup || isMapImageLike,
                children
            };
        };

        const topLayers = (view.map as any)?.layers?.items
            || (view.map as any)?.allLayers?.items
            || [];

        // Only top-level layers (allLayers is a flat list that includes
        // descendants; we want the actual hierarchy here).
        const tops = (view.map as any)?.layers?.items || topLayers;

        const tree: LayerTreeNode[] = [];
        for (const top of tops) {
            const node = buildNode(top, 0);
            if (node) tree.push(node);
        }

        return { tree, leafKeys: Array.from(new Set(leafKeys)) };
    }, []);

    // Wire JimuMapViewComponent → tree state. Triggers when the source map
    // widget loads.
    const onMapViewActivated = React.useCallback((jmv: JimuMapView) => {
        if (!jmv?.view) {
            setLayerTree([]);
            setAllLeafKeys([]);
            setLayerTreeReady(false);
            return;
        }
        const view = jmv.view as __esri.MapView;
        view.when(() => {
            try {
                const { tree, leafKeys } = buildLayerTree(view);
                setLayerTree(tree);
                setAllLeafKeys(leafKeys);
                setLayerTreeReady(true);
            } catch (_e) {
                setLayerTreeReady(true);
            }
        }).catch(() => {
            setLayerTreeReady(true);
        });
    }, [buildLayerTree]);

    // Compute the EFFECTIVE selection set: actual queryable layer keys that
    // would be queried at runtime. mode 'all' or unset = every leaf.
    //
    // The persisted `selectedKeys` list can contain GROUP keys when the dev
    // selected an entire group in the UI (see writeSelection — we collapse
    // fully-covered groups to a single key so layers added later are
    // auto-included). When that happens, we expand each group key back into
    // its current queryable descendant keys here, so the UI's tri-state
    // checkboxes accurately reflect what's selected.
    const getEffectiveSelection = (): Set<string> => {
        const sel: WhatsHereLayerSelection | undefined = config.whatsHereLayerSelection as any;
        if (!sel || !sel.mode || sel.mode === 'all') return new Set(allLeafKeys);

        const stored = new Set(sel.selectedKeys || []);

        // Walk the tree and, for any group whose key is stored, add every
        // queryable descendant of that group to the effective set. Leaf keys
        // already in the stored set are kept as-is.
        const effective = new Set<string>();
        const expand = (node: LayerTreeNode, inheritSelected: boolean): void => {
            const nodeSelected = inheritSelected || stored.has(node.key);
            if (!node.isGroup && node.queryable && nodeSelected) {
                effective.add(node.key);
            }
            for (const child of node.children) expand(child, nodeSelected);
        };
        for (const root of layerTree) expand(root, false);

        return effective;
    };

    // Persist a new effective selection. If it covers every leaf, collapse to
    // mode='all' (cleaner config + survives layers added later).
    //
    // For partial selections, we ALSO collapse any GroupLayer whose entire
    // queryable descendant set is selected into a single group-key entry.
    // The runtime filter walks ancestor keys, so storing the group key alone
    // is equivalent to listing every leaf — with the bonus that layers added
    // to that group *after* this setting is saved (programmatically, via
    // add-data, via webmap edits) will be auto-included because their
    // ancestor's key is in the selection. Without this collapse step, the
    // selection would be a frozen list of the leaves present at save time.
    const writeSelection = (effective: Set<string>) => {
        // Preserve any existing trustedGroupKeys when rewriting the selection
        // — they're orthogonal to the leaf/group selectedKeys list and must
        // not get clobbered by a checkbox toggle.
        const existingTrusted = (config.whatsHereLayerSelection as any)?.trustedGroupKeys || [];

        const allOn = allLeafKeys.length > 0 && allLeafKeys.every(k => effective.has(k));
        if (allOn) {
            const next: WhatsHereLayerSelection = {
                mode: 'all',
                selectedKeys: [],
                trustedGroupKeys: existingTrusted.length > 0 ? existingTrusted : undefined
            };
            props.onSettingChange({
                id: (props as any).id,
                config: Immutable({ ...config, whatsHereLayerSelection: next })
            });
            return;
        }

        // Walk the layer tree. For every group whose every queryable
        // descendant is in `effective`, substitute the group's key for
        // those descendants in the persisted set. Groups whose descendants
        // are only partially selected stay as leaf-key lists.
        const collapsed = new Set<string>(effective);
        const recurse = (node: LayerTreeNode): void => {
            // Children first — collapse deepest groups before evaluating
            // parents, so a parent can see a fully-covered child group as
            // "all selected" via the leaves underneath it.
            for (const child of node.children) recurse(child);

            if (!node.isGroup) return;
            const leaves = collectLeafKeysUnder(node);
            if (leaves.length === 0) return;
            const allSelected = leaves.every(k => collapsed.has(k));
            if (!allSelected) return;

            // Drop the leaves and add the group key in their place.
            for (const k of leaves) collapsed.delete(k);
            collapsed.add(node.key);
        };
        for (const root of layerTree) recurse(root);

        const next: WhatsHereLayerSelection = {
            mode: 'selected',
            selectedKeys: Array.from(collapsed),
            trustedGroupKeys: existingTrusted.length > 0 ? existingTrusted : undefined
        };
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({ ...config, whatsHereLayerSelection: next })
        });
    };

    // Trust-toggle support. A "trusted" group / map-service means every
    // current AND future nested layer is auto-included at runtime,
    // without needing to re-tick boxes when sublayers are added later.
    const isNodeTrusted = (node: LayerTreeNode): boolean => {
        const trusted = (config.whatsHereLayerSelection as any)?.trustedGroupKeys || [];
        return Array.isArray(trusted) && trusted.includes(node.key);
    };

    const setNodeTrusted = (node: LayerTreeNode, trusted: boolean): void => {
        const existing: string[] = (config.whatsHereLayerSelection as any)?.trustedGroupKeys || [];
        const set = new Set(existing);
        if (trusted) set.add(node.key);
        else set.delete(node.key);

        const newList = Array.from(set);
        const cur = (config.whatsHereLayerSelection as any) || {};
        const next: WhatsHereLayerSelection = {
            mode: cur.mode || 'all',
            selectedKeys: cur.selectedKeys || [],
            trustedGroupKeys: newList.length > 0 ? newList : undefined
        };
        props.onSettingChange({
            id: (props as any).id,
            config: Immutable({ ...config, whatsHereLayerSelection: next })
        });
    };

    // Recursively gather every queryable leaf key beneath a tree node.
    const collectLeafKeysUnder = (node: LayerTreeNode): string[] => {
        if (!node.isGroup) return node.queryable ? [node.key] : [];
        const out: string[] = [];
        for (const child of node.children) {
            for (const k of collectLeafKeysUnder(child)) out.push(k);
        }
        return out;
    };

    const isLayerSelected = (key: string): boolean => getEffectiveSelection().has(key);

    // Returns 'all' | 'some' | 'none' for a node, based on how many of its
    // queryable descendants are selected.
    const getNodeState = (node: LayerTreeNode): 'all' | 'some' | 'none' => {
        const eff = getEffectiveSelection();
        if (!node.isGroup) return eff.has(node.key) ? 'all' : 'none';
        const leaves = collectLeafKeysUnder(node);
        if (leaves.length === 0) return 'none';
        let on = 0;
        for (const l of leaves) if (eff.has(l)) on++;
        if (on === 0) return 'none';
        if (on === leaves.length) return 'all';
        return 'some';
    };

    // Toggle a single node (cascading to descendants for groups).
    const toggleNode = (node: LayerTreeNode, checked: boolean) => {
        const eff = getEffectiveSelection();
        const affected = node.isGroup ? collectLeafKeysUnder(node) : (node.queryable ? [node.key] : []);
        for (const k of affected) {
            if (checked) eff.add(k);
            else eff.delete(k);
        }
        writeSelection(eff);
    };

    const selectAllLayers = () => writeSelection(new Set(allLeafKeys));
    const deselectAllLayers = () => writeSelection(new Set());

    const updateFieldSelection = (layerIndex: number, fieldName: string, selected: boolean) => {
        const layer = config.featureLayers[layerIndex];
        const currentFields = layer.fields || [];

        let updatedFields;
        if (selected) {
            updatedFields = [...currentFields, fieldName];
        } else {
            updatedFields = currentFields.filter(f => f !== fieldName);
        }

        updateFeatureLayer(layerIndex, {
            ...layer,
            fields: updatedFields
        });
    };

    const toggleAllFields = (layerIndex: number, showAll: boolean) => {
        const layer = config.featureLayers[layerIndex];
        const availableFields = fieldStates[layerIndex]?.fields || [];

        const updatedFields = showAll ? availableFields.map(f => f.name) : [];

        updateFeatureLayer(layerIndex, {
            ...layer,
            fields: updatedFields
        });
    };

    const formatActionName = (key: string): string => {
        const actionNames = {
            zoomIn: 'Zoom In',
            zoomOut: 'Zoom Out',
            centerHere: 'Center Here',
            copyCoordinates: 'Copy Coordinates',
            plotCoordinates: 'Plot Coordinates',
            plotMarker: 'Plot Marker',
            addText: 'Add Text',
            streetView: 'Open in Google Street View',
            pictometry: 'Open in Pictometry',
            measureDistance: 'Measure Distance',
            measureArea: 'Measure Area',
            whatsHere: `What's here?`,
            propertyReport: 'Property Information',
            mailingLabels: 'Mailing Labels'
        };
        return actionNames[key] || key.replace(/([A-Z])/g, ' $1');
    };

    // IMPROVED STYLES WITH BETTER ORGANIZATION AND CONSISTENCY
    const styles = React.useMemo(() => ({
        // === BASE LAYOUT STYLES ===
        mainContainer: {
            fontSize: '13px',
            lineHeight: '1.4',
            color: 'var(--dark-800)'
        } as React.CSSProperties,

        // === INPUT STYLES ===
        inputContainer: {
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            width: '100%'
        } as React.CSSProperties,

        inputLabel: {
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--dark-600)',
            lineHeight: '1.3',
            marginBottom: '0'
        } as React.CSSProperties,

        helpText: {
            fontSize: '11px',
            color: 'var(--light-600)',
            lineHeight: '1.3',
            fontStyle: 'italic'
        } as React.CSSProperties,

        disabledText: {
            fontSize: '11px',
            color: 'var(--light-500)',
            lineHeight: '1.3',
            fontStyle: 'italic'
        } as React.CSSProperties,

        // === GRID LAYOUTS ===
        settingsGrid: {
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '16px',
            alignItems: 'start'
        } as React.CSSProperties,

        plotSettingsGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '16px',
            alignItems: 'end'
        } as React.CSSProperties,

        // === RADIO GROUP STYLES ===
        radioGroup: {
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            alignItems: 'flex-start'
        } as React.CSSProperties,

        radioLabel: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            margin: 0,
            padding: '4px 0',
            fontSize: '13px',
            color: 'var(--dark-700)',
            cursor: 'pointer',
            lineHeight: '1.3'
        } as React.CSSProperties,

        // === MEASUREMENT SPECIFIC STYLES ===
        measurementContainer: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: '20px',
            width: '100%'
        } as React.CSSProperties,

        measurementLabel: {
            minWidth: '100px',
            fontWeight: 600,
            fontSize: '12px',
            paddingTop: '6px',
            flexShrink: 0,
            color: 'var(--dark-600)'
        } as React.CSSProperties,

        measurementRadioGroup: {
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            flex: 1,
            alignItems: 'flex-start'
        } as React.CSSProperties,

        // === COLOR PICKER STYLES ===
        colorPicker: {
            width: '40px',
            height: '32px',
            padding: '2px',
            border: '1px solid var(--light-400)',
            borderRadius: '3px',
            cursor: 'pointer'
        } as React.CSSProperties,

        colorInputContainer: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
        } as React.CSSProperties,

        // === ALERT/WARNING STYLES ===
        warningBox: {
            padding: '12px 16px',
            backgroundColor: 'var(--warning-100)',
            borderRadius: '4px',
            fontSize: '12px',
            color: 'var(--warning-700)',
            border: '1px solid var(--warning-300)',
            lineHeight: '1.4'
        } as React.CSSProperties,

        errorContainer: {
            padding: '10px 12px',
            backgroundColor: 'var(--danger-100)',
            borderRadius: '4px',
            fontSize: '11px',
            color: 'var(--danger-700)',
            border: '1px solid var(--danger-300)',
            lineHeight: '1.4'
        } as React.CSSProperties,

        // === FEATURE LAYER STYLES ===
        featureLayerContainer: {
            border: '1px solid var(--light-400)',
            borderRadius: '6px',
            padding: '0',
            marginBottom: '12px',
            backgroundColor: 'var(--white)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
        } as React.CSSProperties,

        featureLayerHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            backgroundColor: 'var(--light-200)',
            borderBottom: '1px solid var(--light-400)',
            borderRadius: '5px 5px 0 0'
        } as React.CSSProperties,

        featureLayerTitle: {
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--dark-800)',
            lineHeight: '1.3'
        } as React.CSSProperties,

        featureLayerContent: {
            padding: '16px'
        } as React.CSSProperties,

        removeButton: {
            minWidth: '28px',
            height: '28px',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '3px'
        } as React.CSSProperties,

        // === FIELD SELECTION STYLES ===
        fieldSelectionContainer: {
            marginTop: '12px',
            padding: '12px',
            backgroundColor: 'var(--light-100)',
            borderRadius: '4px',
            border: '1px solid var(--light-300)'
        } as React.CSSProperties,

        fieldSelectionHeader: {
            fontSize: '11px',
            fontWeight: 600,
            marginBottom: '8px',
            color: 'var(--dark-600)',
            lineHeight: '1.3'
        } as React.CSSProperties,

        fieldCheckboxList: {
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            maxHeight: '180px',
            overflowY: 'auto',
            marginBottom: '12px',
            padding: '4px 0'
        } as React.CSSProperties,

        fieldCheckboxItem: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '4px 0',
            lineHeight: '1.3'
        } as React.CSSProperties,

        fieldTextContainer: {
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            flex: 1,
            minWidth: 0
        } as React.CSSProperties,

        fieldName: {
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--dark-800)',
            lineHeight: '1.3',
            wordBreak: 'break-word'
        } as React.CSSProperties,

        fieldAlias: {
            fontSize: '11px',
            color: 'var(--light-600)',
            fontStyle: 'italic',
            lineHeight: '1.3',
            wordBreak: 'break-word'
        } as React.CSSProperties,

        showAllContainer: {
            borderTop: '1px solid var(--light-300)',
            paddingTop: '12px',
            marginTop: '8px',
            display: 'flex',
            gap: '8px'
        } as React.CSSProperties,

        // === MISC STYLES ===
        loadingContainer: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '20px',
            fontSize: '11px',
            color: 'var(--light-600)',
            lineHeight: '1.3'
        } as React.CSSProperties,

        urlInputContainer: {
            display: 'flex',
            alignItems: 'flex-end',
            gap: '8px'
        } as React.CSSProperties,

        refreshButton: {
            marginLeft: '0'
        } as React.CSSProperties,

        addButton: {
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '12px 16px',
            border: '2px dashed var(--light-500)',
            borderRadius: '4px',
            backgroundColor: 'transparent',
            color: 'var(--light-600)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            fontSize: '13px',
            fontWeight: 500,
            minHeight: '40px'
        } as React.CSSProperties,

        emptyState: {
            textAlign: 'center',
            padding: '32px 20px',
            color: 'var(--light-600)',
            fontSize: '12px',
            lineHeight: '1.4'
        } as React.CSSProperties,

        fieldRow: {
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            marginBottom: '16px'
        } as React.CSSProperties,

        sectionDescription: {
            fontSize: '12px',
            color: 'var(--light-600)',
            lineHeight: '1.4',
            marginBottom: '16px',
            padding: '0'
        } as React.CSSProperties
    }), []);

    const actionEntries = React.useMemo(() => Object.entries(enabledActions), [enabledActions]);
    const unitOptions = React.useMemo(() => ['feet', 'yards', 'miles', 'meters', 'kilometers'], []);

    return (
        <div className="widget-setting-right-click-map" style={styles.mainContainer}>
            {/* Invisible: spins up the map view so we can walk its layer tree
                for the developer-facing layer-selection UI below. */}
            {(config.useMapWidgetIds && config.useMapWidgetIds.length > 0) && (
                <JimuMapViewComponent
                    useMapWidgetId={config.useMapWidgetIds[0]}
                    onActiveViewChange={onMapViewActivated}
                />
            )}
            <SettingSection title="Map Configuration">
                <SettingRow>
                    <div style={styles.sectionDescription}>
                        Select a map widget to enable right-click functionality
                    </div>
                </SettingRow>
                <SettingRow>
                    <MapWidgetSelector
                        onSelect={onMapWidgetSelected}
                        useMapWidgetIds={Immutable(config.useMapWidgetIds || [])}
                    />
                </SettingRow>
            </SettingSection>

            <SettingSection title="Import / Export Configuration">
                <SettingRow>
                    <div style={{ ...styles.sectionDescription, lineHeight: 1.45 }}>
                        Save the current widget configuration to an XML file you
                        can share or load into another Experience. Everything in
                        this panel is captured except the bound map widget, which
                        stays tied to its Experience.
                    </div>
                </SettingRow>

                {/* ── Export ─────────────────────────────────────────────── */}
                <SettingRow>
                    <div style={{ width: '100%' }}>
                        <div style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            opacity: 0.7,
                            marginBottom: '8px'
                        }}>
                            Export
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <Button size="sm" type="primary" onClick={handleGenerateExport}>
                                Generate XML
                            </Button>
                            <Button size="sm" type="default" onClick={handleDownloadExport}>
                                Download
                            </Button>
                            {exportXml && (
                                <Button size="sm" type="tertiary" onClick={handleCopyExport}>
                                    Copy
                                </Button>
                            )}
                        </div>
                    </div>
                </SettingRow>

                {exportXml && (
                    <SettingRow>
                        <TextArea
                            value={exportXml}
                            readOnly
                            spellCheck={false}
                            style={{
                                width: '100%',
                                minHeight: '160px',
                                fontFamily: 'Consolas, "Courier New", monospace',
                                fontSize: '11px',
                                resize: 'vertical',
                                boxSizing: 'border-box'
                            }}
                        />
                    </SettingRow>
                )}

                {/* ── Import ─────────────────────────────────────────────── */}
                <SettingRow>
                    <div style={{ width: '100%' }}>
                        <div style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            opacity: 0.7,
                            marginBottom: '8px'
                        }}>
                            Import
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <Button
                                size="sm"
                                type="default"
                                onClick={() => importFileInputRef.current?.click()}
                            >
                                Load file
                            </Button>
                            <Button
                                size="sm"
                                type="primary"
                                onClick={handleImport}
                                disabled={!importXml.trim()}
                            >
                                Apply
                            </Button>
                            {importXml && (
                                <Button
                                    size="sm"
                                    type="tertiary"
                                    onClick={() => {
                                        setImportXml('');
                                        setImportError(null);
                                        setImportSuccess(false);
                                    }}
                                >
                                    Clear
                                </Button>
                            )}
                            <input
                                ref={importFileInputRef}
                                type="file"
                                accept=".xml,application/xml,text/xml"
                                onChange={handleFileImport}
                                style={{ display: 'none' }}
                                aria-hidden="true"
                            />
                        </div>
                    </div>
                </SettingRow>

                <SettingRow>
                    <TextArea
                        value={importXml}
                        onChange={(e) => {
                            setImportXml(e.target.value);
                            setImportError(null);
                            setImportSuccess(false);
                        }}
                        placeholder="Paste exported XML here, or use Load file."
                        spellCheck={false}
                        style={{
                            width: '100%',
                            minHeight: '140px',
                            fontFamily: 'Consolas, "Courier New", monospace',
                            fontSize: '11px',
                            resize: 'vertical',
                            boxSizing: 'border-box'
                        }}
                    />
                </SettingRow>

                {importError && (
                    <SettingRow>
                        <Alert
                            type="error"
                            text={importError}
                            closable
                            onClose={() => setImportError(null)}
                            style={{ width: '100%' }}
                        />
                    </SettingRow>
                )}
                {importSuccess && (
                    <SettingRow>
                        <Alert
                            type="success"
                            text="Configuration imported. Map widget binding preserved."
                            closable
                            onClose={() => setImportSuccess(false)}
                            style={{ width: '100%' }}
                        />
                    </SettingRow>
                )}
            </SettingSection>

            <SettingSection title="Enable Right-Click Actions">
                {actionEntries.map(([key, value]) => (
                    <SettingRow key={key} label={formatActionName(key)}>
                        <Switch checked={value} onChange={(e) => updateEnabledAction(key, e.target.checked)} />
                    </SettingRow>
                ))}
            </SettingSection>

            {/* Property Report Settings - Only show if propertyReport is enabled */}
            {enabledActions.propertyReport && (
                <SettingSection title="Property Report Settings">
                    <SettingRow>
                        <div style={styles.sectionDescription}>
                            Opens the Property Information widget in its widget controller and triggers a report at the right-clicked location.
                        </div>
                    </SettingRow>
                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Target Widget</label>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <Button size="sm" type="primary" onClick={scanForPropertyReportWidgets} disabled={scanning} style={{ whiteSpace: 'nowrap' }}>
                                    {scanning ? 'Scanning...' : 'Scan App'}
                                </Button>
                                <span style={{ ...styles.helpText, margin: 0 }}>
                                    Reads app config to find widgets
                                </span>
                            </div>
                            {detectedWidgets.length > 0 ? (
                                <Select
                                    value={config.propertyReportSettings?.targetWidgetId || ''}
                                    onChange={(e) => updatePropertyReportSetting('targetWidgetId', e.target.value)}
                                    size="sm"
                                    placeholder="Select a widget..."
                                >
                                    <Option value="">— Select a widget —</Option>
                                    {detectedWidgets.map((w) => (
                                        <Option key={w.id} value={w.id}>
                                            {w.label}
                                        </Option>
                                    ))}
                                </Select>
                            ) : (
                                <TextInput
                                    value={config.propertyReportSettings?.targetWidgetId || ''}
                                    onChange={(e) => updatePropertyReportSetting('targetWidgetId', e.target.value)}
                                    placeholder="e.g. widget_3"
                                    size="sm"
                                />
                            )}
                            {config.propertyReportSettings?.targetWidgetId && (
                                <span style={styles.helpText}>
                                    Widget ID: {config.propertyReportSettings.targetWidgetId}
                                </span>
                            )}
                            <label style={{ ...styles.inputLabel, marginTop: '8px' }}>Parent Container</label>
                            {detectedWidgets.length > 0 ? (
                                <Select
                                    value={config.propertyReportSettings?.parentControllerId || ''}
                                    onChange={(e) => {
                                        const id = e.target.value;
                                        // Set both fields atomically so the type
                                        // auto-detection doesn't race with the id
                                        // assignment and wipe one of them out.
                                        const picked = detectedWidgets.find(w => w.id === id);
                                        const cls = classifyContainerUri(picked?.uri);
                                        const newType = cls === 'accordion' ? 'accordion' : (cls === 'controller' ? 'controller' : (id ? 'controller' : 'none'));
                                        updatePropertyReportSettings({
                                            parentControllerId: id,
                                            parentContainerType: newType
                                        });
                                    }}
                                    size="sm"
                                    placeholder="Select the parent container..."
                                >
                                    <Option value="">— None (target widget opens directly) —</Option>
                                    {containerWidgets.map((w) => {
                                        const cls = classifyContainerUri(w.uri);
                                        const badge = cls === 'accordion' ? ' [Accordion]' : (cls === 'controller' ? ' [Controller]' : '');
                                        return (
                                            <Option key={w.id} value={w.id}>
                                                {w.label}{badge}
                                            </Option>
                                        );
                                    })}
                                </Select>
                            ) : (
                                <TextInput
                                    value={config.propertyReportSettings?.parentControllerId || ''}
                                    onChange={(e) => updatePropertyReportSetting('parentControllerId', e.target.value)}
                                    placeholder="e.g. widget_75"
                                    size="sm"
                                />
                            )}
                            <span style={styles.helpText}>
                                The container widget that holds the Property Information widget. Pick a Widget Controller (sidebar/panel) or an Accordion. Leave empty if the target widget is shown directly (top-level).
                            </span>
                            <label style={{ ...styles.inputLabel, marginTop: '8px' }}>Container Type</label>
                            <Select
                                value={config.propertyReportSettings?.parentContainerType || (config.propertyReportSettings?.parentControllerId ? 'controller' : 'none')}
                                onChange={(e) => updatePropertyReportSetting('parentContainerType', e.target.value)}
                                size="sm"
                            >
                                <Option value="controller">Widget Controller (open / close as a panel)</Option>
                                <Option value="accordion">Accordion (expand the matching section)</Option>
                                <Option value="controller+accordion">Widget Controller → Accordion (nested)</Option>
                                <Option value="none">No container (just open the target widget)</Option>
                            </Select>
                            <span style={styles.helpText}>
                                Auto-detected from the parent above. Pick &quot;Widget Controller → Accordion&quot; when the accordion lives inside a widget controller panel.
                            </span>

                            {/* Inner Accordion picker — only when nested. The
                                outer container above is the Widget Controller;
                                this one is the Accordion the controller opens
                                into. */}
                            {config.propertyReportSettings?.parentContainerType === 'controller+accordion' && (
                                <>
                                    <label style={{ ...styles.inputLabel, marginTop: '8px' }}>Accordion Widget (inside the controller)</label>
                                    {detectedWidgets.length > 0 ? (
                                        <Select
                                            value={config.propertyReportSettings?.accordionWidgetId || ''}
                                            onChange={(e) => updatePropertyReportSetting('accordionWidgetId', e.target.value)}
                                            size="sm"
                                            placeholder="Select the accordion widget..."
                                        >
                                            <Option value="">— Select accordion —</Option>
                                            {containerWidgets
                                                .filter(w => classifyContainerUri(w.uri) === 'accordion' || (w.label || '').toLowerCase().includes('accordion'))
                                                .map((w) => (
                                                    <Option key={w.id} value={w.id}>{w.label}</Option>
                                                ))}
                                        </Select>
                                    ) : (
                                        <TextInput
                                            value={config.propertyReportSettings?.accordionWidgetId || ''}
                                            onChange={(e) => updatePropertyReportSetting('accordionWidgetId', e.target.value)}
                                            placeholder="e.g. widget_82"
                                            size="sm"
                                        />
                                    )}
                                    <span style={styles.helpText}>
                                        The accordion widget that holds the Property Information section. After the controller panel opens, the right-click widget will expand this accordion&apos;s matching section.
                                    </span>
                                </>
                            )}
                            <label style={{ ...styles.inputLabel, marginTop: '8px' }}>Menu Label</label>
                            <TextInput
                                value={config.propertyReportSettings?.menuLabel || ''}
                                onChange={(e) => updatePropertyReportSetting('menuLabel', e.target.value)}
                                placeholder="Property Information"
                                size="sm"
                            />
                            <span style={styles.helpText}>
                                The text shown in the right-click context menu. Leave blank to use "Property Information".
                            </span>
                        </div>
                    </SettingRow>
                </SettingSection>
            )}

            {/* Mailing Labels Settings - Only show if mailingLabels is enabled.
                Mirrors the Property Report section: the user picks a target
                widget (and optional controller) from the same app scan, and
                an optional menu label override. The runtime opens this widget
                and, before launching, prompts the user whether to apply a
                buffer; the choice rides along in the actionPoint payload. */}
            {enabledActions.mailingLabels && (
                <SettingSection title="Mailing Labels Settings">
                    <SettingRow>
                        <div style={styles.sectionDescription}>
                            Opens the Mailing Labels widget in its widget controller at the right-clicked location. Before launching, the user is asked whether to apply a buffer to the selection.
                        </div>
                    </SettingRow>
                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Target Widget</label>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <Button size="sm" type="primary" onClick={scanForPropertyReportWidgets} disabled={scanning} style={{ whiteSpace: 'nowrap' }}>
                                    {scanning ? 'Scanning...' : 'Scan App'}
                                </Button>
                                <span style={{ ...styles.helpText, margin: 0 }}>
                                    Reads app config to find widgets
                                </span>
                            </div>
                            {detectedWidgets.length > 0 ? (
                                <Select
                                    value={config.mailingLabelsSettings?.targetWidgetId || ''}
                                    onChange={(e) => updateMailingLabelsSetting('targetWidgetId', e.target.value)}
                                    size="sm"
                                    placeholder="Select a widget..."
                                >
                                    <Option value="">— Select a widget —</Option>
                                    {detectedWidgets.map((w) => (
                                        <Option key={w.id} value={w.id}>
                                            {w.label}
                                        </Option>
                                    ))}
                                </Select>
                            ) : (
                                <TextInput
                                    value={config.mailingLabelsSettings?.targetWidgetId || ''}
                                    onChange={(e) => updateMailingLabelsSetting('targetWidgetId', e.target.value)}
                                    placeholder="e.g. widget_4"
                                    size="sm"
                                />
                            )}
                            {config.mailingLabelsSettings?.targetWidgetId && (
                                <span style={styles.helpText}>
                                    Widget ID: {config.mailingLabelsSettings.targetWidgetId}
                                </span>
                            )}
                            <label style={{ ...styles.inputLabel, marginTop: '8px' }}>Parent Container</label>
                            {detectedWidgets.length > 0 ? (
                                <Select
                                    value={config.mailingLabelsSettings?.parentControllerId || ''}
                                    onChange={(e) => {
                                        const id = e.target.value;
                                        const picked = detectedWidgets.find(w => w.id === id);
                                        const cls = classifyContainerUri(picked?.uri);
                                        const newType = cls === 'accordion' ? 'accordion' : (cls === 'controller' ? 'controller' : (id ? 'controller' : 'none'));
                                        // Write both fields atomically so id and
                                        // type don't race and overwrite each other.
                                        updateMailingLabelsSettings({
                                            parentControllerId: id,
                                            parentContainerType: newType
                                        });
                                    }}
                                    size="sm"
                                    placeholder="Select the parent container..."
                                >
                                    <Option value="">— None (target widget opens directly) —</Option>
                                    {containerWidgets.map((w) => {
                                        const cls = classifyContainerUri(w.uri);
                                        const badge = cls === 'accordion' ? ' [Accordion]' : (cls === 'controller' ? ' [Controller]' : '');
                                        return (
                                            <Option key={w.id} value={w.id}>
                                                {w.label}{badge}
                                            </Option>
                                        );
                                    })}
                                </Select>
                            ) : (
                                <TextInput
                                    value={config.mailingLabelsSettings?.parentControllerId || ''}
                                    onChange={(e) => updateMailingLabelsSetting('parentControllerId', e.target.value)}
                                    placeholder="e.g. widget_75"
                                    size="sm"
                                />
                            )}
                            <span style={styles.helpText}>
                                The container widget that holds the Mailing Labels widget. Pick a Widget Controller (sidebar/panel) or an Accordion. Leave empty if the target widget is shown directly (top-level).
                            </span>
                            <label style={{ ...styles.inputLabel, marginTop: '8px' }}>Container Type</label>
                            <Select
                                value={config.mailingLabelsSettings?.parentContainerType || (config.mailingLabelsSettings?.parentControllerId ? 'controller' : 'none')}
                                onChange={(e) => updateMailingLabelsSetting('parentContainerType', e.target.value)}
                                size="sm"
                            >
                                <Option value="controller">Widget Controller (open / close as a panel)</Option>
                                <Option value="accordion">Accordion (expand the matching section)</Option>
                                <Option value="controller+accordion">Widget Controller → Accordion (nested)</Option>
                                <Option value="none">No container (just open the target widget)</Option>
                            </Select>
                            <span style={styles.helpText}>
                                Auto-detected from the parent above. Pick &quot;Widget Controller → Accordion&quot; when the accordion lives inside a widget controller panel.
                            </span>

                            {config.mailingLabelsSettings?.parentContainerType === 'controller+accordion' && (
                                <>
                                    <label style={{ ...styles.inputLabel, marginTop: '8px' }}>Accordion Widget (inside the controller)</label>
                                    {detectedWidgets.length > 0 ? (
                                        <Select
                                            value={config.mailingLabelsSettings?.accordionWidgetId || ''}
                                            onChange={(e) => updateMailingLabelsSetting('accordionWidgetId', e.target.value)}
                                            size="sm"
                                            placeholder="Select the accordion widget..."
                                        >
                                            <Option value="">— Select accordion —</Option>
                                            {containerWidgets
                                                .filter(w => classifyContainerUri(w.uri) === 'accordion' || (w.label || '').toLowerCase().includes('accordion'))
                                                .map((w) => (
                                                    <Option key={w.id} value={w.id}>{w.label}</Option>
                                                ))}
                                        </Select>
                                    ) : (
                                        <TextInput
                                            value={config.mailingLabelsSettings?.accordionWidgetId || ''}
                                            onChange={(e) => updateMailingLabelsSetting('accordionWidgetId', e.target.value)}
                                            placeholder="e.g. widget_82"
                                            size="sm"
                                        />
                                    )}
                                    <span style={styles.helpText}>
                                        The accordion widget that holds the Mailing Labels section. After the controller panel opens, the right-click widget will expand this accordion&apos;s matching section.
                                    </span>
                                </>
                            )}
                            <label style={{ ...styles.inputLabel, marginTop: '8px' }}>Menu Label</label>
                            <TextInput
                                value={config.mailingLabelsSettings?.menuLabel || ''}
                                onChange={(e) => updateMailingLabelsSetting('menuLabel', e.target.value)}
                                placeholder="Mailing Labels"
                                size="sm"
                            />
                            <span style={styles.helpText}>
                                The text shown in the right-click context menu. Leave blank to use "Mailing Labels".
                            </span>
                        </div>
                    </SettingRow>
                </SettingSection>
            )}

            {/* Plot Coordinates Settings - Only show if plotCoordinates is enabled */}
            {enabledActions.plotCoordinates && (
                <SettingSection title="Plot Coordinates Settings">
                    <SettingRow>
                        <div style={styles.sectionDescription}>
                            Configure how coordinate markers appear on the map. Markers are numbered sequentially and persist during the browser session.
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Coordinate System for Display</label>
                            <div role="radiogroup" style={styles.radioGroup}>
                                <label style={styles.radioLabel}>
                                    <Radio
                                        name="plot-coord-system"
                                        value="map"
                                        checked={plotSettings.coordinateSystem === 'map' || !plotSettings.coordinateSystem}
                                        onChange={() => updatePlotSetting('coordinateSystem', 'map')}
                                    />
                                    Use Map's Native Coordinate System
                                </label>
                                <label style={styles.radioLabel}>
                                    <Radio
                                        name="plot-coord-system"
                                        value="webMercator"
                                        checked={plotSettings.coordinateSystem === 'webMercator'}
                                        onChange={() => updatePlotSetting('coordinateSystem', 'webMercator')}
                                    />
                                    Lat/Lon (WGS84)
                                </label>
                                <label style={styles.radioLabel}>
                                    <Radio
                                        name="plot-coord-system"
                                        value="custom"
                                        checked={plotSettings.coordinateSystem === 'custom'}
                                        onChange={() => updatePlotSetting('coordinateSystem', 'custom')}
                                    />
                                    Custom Coordinate System
                                </label>
                            </div>
                        </div>
                    </SettingRow>

                    {plotSettings.coordinateSystem === 'custom' && (
                        <SettingRow>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Custom WKID</label>
                                <NumericInput
                                    value={plotSettings.customWkid || ''}
                                    onChange={(value) => updatePlotSetting('customWkid', value)}
                                    placeholder="e.g. 3857, 4326, 2154"
                                    size="sm"
                                />
                                <div style={styles.helpText}>
                                    Enter the WKID (Well-Known ID) for your desired coordinate system
                                </div>
                            </div>
                        </SettingRow>
                    )}

                    {plotSettings.coordinateSystem === 'webMercator' && (
                        <SettingRow>
                            <div style={styles.settingsGrid}>
                                <div style={styles.inputContainer}>
                                    <label style={styles.inputLabel}>Lat/Lon Format</label>
                                    <div role="radiogroup" style={styles.radioGroup}>
                                        <label style={styles.radioLabel}>
                                            <Radio
                                                name="coord-format"
                                                value="decimal"
                                                checked={plotSettings.coordinateFormat === 'decimal' || !plotSettings.coordinateFormat}
                                                onChange={() => updatePlotSetting('coordinateFormat', 'decimal')}
                                            />
                                            Decimal Degrees
                                        </label>
                                        <label style={styles.radioLabel}>
                                            <Radio
                                                name="coord-format"
                                                value="dms"
                                                checked={plotSettings.coordinateFormat === 'dms'}
                                                onChange={() => updatePlotSetting('coordinateFormat', 'dms')}
                                            />
                                            Degrees, Minutes, Seconds
                                        </label>
                                    </div>
                                </div>
                                <div style={styles.inputContainer}>
                                    <label style={styles.inputLabel}>Decimal Places</label>
                                    <NumericInput
                                        value={plotSettings.decimalPlaces || 6}
                                        onChange={(value) => updatePlotSetting('decimalPlaces', value)}
                                        min={0}
                                        max={10}
                                        size="sm"
                                        disabled={plotSettings.coordinateFormat === 'dms'}
                                    />
                                </div>
                            </div>
                        </SettingRow>
                    )}

                    {(plotSettings.coordinateSystem === 'map' || plotSettings.coordinateSystem === 'custom') && (
                        <SettingRow>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Decimal Places</label>
                                <NumericInput
                                    value={plotSettings.decimalPlaces || 2}
                                    onChange={(value) => updatePlotSetting('decimalPlaces', value)}
                                    min={0}
                                    max={10}
                                    size="sm"
                                />
                            </div>
                        </SettingRow>
                    )}

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Marker Style</label>
                            <Select
                                value={plotSettings.markerStyle || 'circle'}
                                onChange={(e) => updatePlotSetting('markerStyle', e.target.value)}
                                size="sm"
                            >
                                <Option value="circle">Circle</Option>
                                <Option value="square">Square</Option>
                                <Option value="cross">Cross</Option>
                                <Option value="x">X</Option>
                                <Option value="diamond">Diamond</Option>
                                <Option value="triangle">Triangle</Option>
                                <Option value="pin">Pin</Option>
                            </Select>
                            <div style={styles.helpText}>
                                Choose the shape style for your marker symbol
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.plotSettingsGrid}>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Marker Size</label>
                                <NumericInput
                                    value={plotSettings.markerSize}
                                    onChange={(value) => updatePlotSetting('markerSize', value)}
                                    min={8}
                                    max={24}
                                    size="sm"
                                />
                            </div>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Text Size</label>
                                <NumericInput
                                    value={plotSettings.textSize}
                                    onChange={(value) => updatePlotSetting('textSize', value)}
                                    min={6}
                                    max={16}
                                    size="sm"
                                />
                            </div>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Show Coordinate Labels</label>
                                <Switch
                                    checked={plotSettings.showCoordinateLabels}
                                    onChange={(e) => updatePlotSetting('showCoordinateLabels', e.target.checked)}
                                />
                            </div>
                        </div>
                    </SettingRow>

                    {plotSettings.showCoordinateLabels && (
                        <SettingRow>
                            <div style={styles.settingsGrid}>
                                <div style={styles.inputContainer}>
                                    <label style={styles.inputLabel}>Label Offset (pixels)</label>
                                    <NumericInput
                                        value={plotSettings.labelOffset || 20}
                                        onChange={(value) => updatePlotSetting('labelOffset', value)}
                                        min={5}
                                        max={100}
                                        size="sm"
                                    />
                                    <div style={styles.helpText}>
                                        Distance from marker to coordinate label
                                    </div>
                                </div>
                                <div style={styles.inputContainer}>
                                    <label style={styles.inputLabel}>Label Text Size</label>
                                    <NumericInput
                                        value={plotSettings.labelTextSize || 10}
                                        onChange={(value) => updatePlotSetting('labelTextSize', value)}
                                        min={6}
                                        max={16}
                                        size="sm"
                                    />
                                </div>
                            </div>
                        </SettingRow>
                    )}

                    <SettingRow>
                        <div style={styles.plotSettingsGrid}>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Show Coordinates in Popup</label>
                                <Switch
                                    checked={plotSettings.showCoordinateText}
                                    onChange={(e) => updatePlotSetting('showCoordinateText', e.target.checked)}
                                />
                            </div>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Marker Color</label>
                                <div style={styles.colorInputContainer}>
                                    <input
                                        type="color"
                                        value={plotSettings.markerColor}
                                        onChange={(e) => updatePlotSetting('markerColor', e.target.value)}
                                        style={styles.colorPicker}
                                    />
                                    <TextInput
                                        value={plotSettings.markerColor}
                                        onChange={(e) => updatePlotSetting('markerColor', e.target.value)}
                                        placeholder="#ff6b6b"
                                        size="sm"
                                        style={{ flex: 1 }}
                                    />
                                </div>
                            </div>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Text Color</label>
                                <div style={styles.colorInputContainer}>
                                    <input
                                        type="color"
                                        value={plotSettings.textColor}
                                        onChange={(e) => updatePlotSetting('textColor', e.target.value)}
                                        style={styles.colorPicker}
                                    />
                                    <TextInput
                                        value={plotSettings.textColor}
                                        onChange={(e) => updatePlotSetting('textColor', e.target.value)}
                                        placeholder="#ffffff"
                                        size="sm"
                                        style={{ flex: 1 }}
                                    />
                                </div>
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Outline Color</label>
                            <div style={styles.colorInputContainer}>
                                <input
                                    type="color"
                                    value={plotSettings.markerOutlineColor || '#ffffff'}
                                    onChange={(e) => updatePlotSetting('markerOutlineColor', e.target.value)}
                                    style={styles.colorPicker}
                                />
                                <TextInput
                                    value={plotSettings.markerOutlineColor || '#ffffff'}
                                    onChange={(e) => updatePlotSetting('markerOutlineColor', e.target.value)}
                                    placeholder="#ffffff"
                                    size="sm"
                                    style={{ flex: 1 }}
                                />
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Outline Width</label>
                            <NumericInput
                                value={plotSettings.markerOutlineWidth || 1}
                                onChange={(value) => updatePlotSetting('markerOutlineWidth', value)}
                                min={0}
                                max={8}
                                size="sm"
                            />
                            <div style={styles.helpText}>Thickness in pixels</div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Rotation Angle</label>
                            <NumericInput
                                value={plotSettings.markerAngle || 0}
                                onChange={(value) => updatePlotSetting('markerAngle', value)}
                                min={0}
                                max={360}
                                size="sm"
                                style={{ maxWidth: '150px' }}
                            />
                            <div style={styles.helpText}>
                                Rotation angle in degrees (0-360)
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>X Offset</label>
                            <NumericInput
                                value={plotSettings.markerXOffset || 0}
                                onChange={(value) => updatePlotSetting('markerXOffset', value)}
                                min={-50}
                                max={50}
                                size="sm"
                            />
                            <div style={styles.helpText}>Horizontal offset in pixels</div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Y Offset</label>
                            <NumericInput
                                value={plotSettings.markerYOffset || 0}
                                onChange={(value) => updatePlotSetting('markerYOffset', value)}
                                min={-50}
                                max={50}
                                size="sm"
                            />
                            <div style={styles.helpText}>Vertical offset in pixels</div>
                        </div>
                    </SettingRow>

                    {plotSettings.showCoordinateLabels && (
                        <SettingRow>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Label Text Color</label>
                                <div style={styles.colorInputContainer}>
                                    <input
                                        type="color"
                                        value={plotSettings.labelTextColor || '#000000'}
                                        onChange={(e) => updatePlotSetting('labelTextColor', e.target.value)}
                                        style={styles.colorPicker}
                                    />
                                    <TextInput
                                        value={plotSettings.labelTextColor || '#000000'}
                                        onChange={(e) => updatePlotSetting('labelTextColor', e.target.value)}
                                        placeholder="#000000"
                                        size="sm"
                                        style={{ flex: 1 }}
                                    />
                                </div>
                            </div>
                        </SettingRow>
                    )}

                    <SettingRow>
                        <div style={{
                            ...styles.fieldSelectionContainer,
                            textAlign: 'center',
                            marginTop: '16px'
                        }}>
                            <div style={styles.fieldSelectionHeader}>
                                Marker Preview
                            </div>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                padding: '20px',
                                backgroundColor: '#f8f9fa',
                                borderRadius: '4px',
                                border: '1px solid var(--light-300)',
                                minHeight: '80px'
                            }}>
                                {/* Preview will be rendered based on current settings */}
                                <div style={{
                                    width: `${plotSettings.markerSize}px`,
                                    height: `${plotSettings.markerSize}px`,
                                    backgroundColor: plotSettings.markerColor,
                                    border: `${plotSettings.markerOutlineWidth || 1}px solid ${plotSettings.markerOutlineColor || '#ffffff'}`,
                                    opacity: plotSettings.markerOpacity || 1,
                                    transform: `rotate(${plotSettings.markerAngle || 0}deg) translate(${plotSettings.markerXOffset || 0}px, ${plotSettings.markerYOffset || 0}px)`,
                                    borderRadius: (plotSettings.markerStyle || 'circle') === 'circle' ? '50%' :
                                        (plotSettings.markerStyle || 'circle') === 'diamond' ? '0' :
                                            (plotSettings.markerStyle || 'circle') === 'triangle' ? '0' :
                                                (plotSettings.markerStyle || 'circle') === 'pin' ? '50% 50% 50% 0' : '0',
                                    clipPath: (plotSettings.markerStyle || 'circle') === 'diamond' ? 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' :
                                        (plotSettings.markerStyle || 'circle') === 'triangle' ? 'polygon(50% 0%, 0% 100%, 100% 100%)' :
                                            (plotSettings.markerStyle || 'circle') === 'cross' ? 'polygon(40% 0%, 60% 0%, 60% 40%, 100% 40%, 100% 60%, 60% 60%, 60% 100%, 40% 100%, 40% 60%, 0% 60%, 0% 40%, 40% 40%)' :
                                                (plotSettings.markerStyle || 'circle') === 'x' ? 'polygon(20% 0%, 0% 20%, 30% 50%, 0% 80%, 20% 100%, 50% 70%, 80% 100%, 100% 80%, 70% 50%, 100% 20%, 80% 0%, 50% 30%)' :
                                                    (plotSettings.markerStyle || 'circle') === 'pin' ? 'circle(40% at 50% 40%)' :
                                                        'none'
                                }} />
                                <div style={{
                                    marginLeft: '12px',
                                    fontSize: '11px',
                                    color: 'var(--light-600)',
                                    textAlign: 'left'
                                }}>
                                    <div>Size: {plotSettings.markerSize}px</div>
                                    <div>Style: {plotSettings.markerStyle || 'circle'}</div>
                                    <div>Outline: {plotSettings.markerOutlineWidth || 1}px</div>
                                    {(plotSettings.markerAngle || 0) !== 0 && <div>Rotation: {plotSettings.markerAngle}°</div>}
                                    {((plotSettings.markerXOffset || 0) !== 0 || (plotSettings.markerYOffset || 0) !== 0) &&
                                        <div>Offset: {plotSettings.markerXOffset || 0}, {plotSettings.markerYOffset || 0}</div>
                                    }
                                </div>
                            </div>
                        </div>
                    </SettingRow>
                </SettingSection>
            )}

            {/* Simple Marker Settings - Only show if plotMarker is enabled */}
            {enabledActions.plotMarker && (
                <SettingSection title="Simple Marker Settings">
                    <SettingRow>
                        <div style={styles.sectionDescription}>
                            Configure simple markers with various styles and customization options.
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Marker Style</label>
                            <Select
                                value={markerSettings.markerStyle || 'circle'}
                                onChange={(e) => updateMarkerSetting('markerStyle', e.target.value)}
                                size="sm"
                            >
                                <Option value="circle">Circle</Option>
                                <Option value="square">Square</Option>
                                <Option value="cross">Cross</Option>
                                <Option value="x">X</Option>
                                <Option value="diamond">Diamond</Option>
                                <Option value="triangle">Triangle</Option>
                                <Option value="pin">Pin</Option>
                            </Select>
                            <div style={styles.helpText}>
                                Choose the shape style for your marker symbol
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Marker Size</label>
                            <NumericInput
                                value={markerSettings.markerSize}
                                onChange={(value) => updateMarkerSetting('markerSize', value)}
                                min={4}
                                max={48}
                                size="sm"
                            />
                            <div style={styles.helpText}>Size in pixels</div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Opacity</label>
                            <NumericInput
                                value={markerSettings.markerOpacity || 1}
                                onChange={(value) => updateMarkerSetting('markerOpacity', value)}
                                min={0}
                                max={1}
                                step={0.1}
                                size="sm"
                            />
                            <div style={styles.helpText}>0.0 to 1.0 transparency</div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Marker Color</label>
                            <div style={styles.colorInputContainer}>
                                <input
                                    type="color"
                                    value={markerSettings.markerColor}
                                    onChange={(e) => updateMarkerSetting('markerColor', e.target.value)}
                                    style={styles.colorPicker}
                                />
                                <TextInput
                                    value={markerSettings.markerColor}
                                    onChange={(e) => updateMarkerSetting('markerColor', e.target.value)}
                                    placeholder="#0078ff"
                                    size="sm"
                                    style={{ flex: 1 }}
                                />
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Outline Color</label>
                            <div style={styles.colorInputContainer}>
                                <input
                                    type="color"
                                    value={markerSettings.markerOutlineColor || '#ffffff'}
                                    onChange={(e) => updateMarkerSetting('markerOutlineColor', e.target.value)}
                                    style={styles.colorPicker}
                                />
                                <TextInput
                                    value={markerSettings.markerOutlineColor || '#ffffff'}
                                    onChange={(e) => updateMarkerSetting('markerOutlineColor', e.target.value)}
                                    placeholder="#ffffff"
                                    size="sm"
                                    style={{ flex: 1 }}
                                />
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Outline Width</label>
                            <NumericInput
                                value={markerSettings.markerOutlineWidth || 1}
                                onChange={(value) => updateMarkerSetting('markerOutlineWidth', value)}
                                min={0}
                                max={8}
                                size="sm"
                            />
                            <div style={styles.helpText}>Thickness in pixels</div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Rotation Angle</label>
                            <NumericInput
                                value={markerSettings.markerAngle || 0}
                                onChange={(value) => updateMarkerSetting('markerAngle', value)}
                                min={0}
                                max={360}
                                size="sm"
                                style={{ maxWidth: '150px' }}
                            />
                            <div style={styles.helpText}>
                                Rotation angle in degrees (0-360)
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>X Offset</label>
                            <NumericInput
                                value={markerSettings.markerXOffset || 0}
                                onChange={(value) => updateMarkerSetting('markerXOffset', value)}
                                min={-50}
                                max={50}
                                size="sm"
                            />
                            <div style={styles.helpText}>Horizontal offset in pixels</div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Y Offset</label>
                            <NumericInput
                                value={markerSettings.markerYOffset || 0}
                                onChange={(value) => updateMarkerSetting('markerYOffset', value)}
                                min={-50}
                                max={50}
                                size="sm"
                            />
                            <div style={styles.helpText}>Vertical offset in pixels</div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={{
                            ...styles.fieldSelectionContainer,
                            textAlign: 'center',
                            marginTop: '16px'
                        }}>
                            <div style={styles.fieldSelectionHeader}>
                                Marker Preview
                            </div>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                padding: '20px',
                                backgroundColor: '#f8f9fa',
                                borderRadius: '4px',
                                border: '1px solid var(--light-300)',
                                minHeight: '80px'
                            }}>
                                {/* Preview will be rendered based on current settings */}
                                <div style={{
                                    width: `${markerSettings.markerSize}px`,
                                    height: `${markerSettings.markerSize}px`,
                                    backgroundColor: markerSettings.markerColor,
                                    border: `${markerSettings.markerOutlineWidth || 1}px solid ${markerSettings.markerOutlineColor || '#ffffff'}`,
                                    opacity: markerSettings.markerOpacity || 1,
                                    transform: `rotate(${markerSettings.markerAngle || 0}deg) translate(${markerSettings.markerXOffset || 0}px, ${markerSettings.markerYOffset || 0}px)`,
                                    borderRadius: markerSettings.markerStyle === 'circle' ? '50%' :
                                        markerSettings.markerStyle === 'diamond' ? '0' :
                                            markerSettings.markerStyle === 'triangle' ? '0' :
                                                markerSettings.markerStyle === 'pin' ? '50% 50% 50% 0' : '0',
                                    clipPath: markerSettings.markerStyle === 'diamond' ? 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' :
                                        markerSettings.markerStyle === 'triangle' ? 'polygon(50% 0%, 0% 100%, 100% 100%)' :
                                            markerSettings.markerStyle === 'cross' ? 'polygon(40% 0%, 60% 0%, 60% 40%, 100% 40%, 100% 60%, 60% 60%, 60% 100%, 40% 100%, 40% 60%, 0% 60%, 0% 40%, 40% 40%)' :
                                                markerSettings.markerStyle === 'x' ? 'polygon(20% 0%, 0% 20%, 30% 50%, 0% 80%, 20% 100%, 50% 70%, 80% 100%, 100% 80%, 70% 50%, 100% 20%, 80% 0%, 50% 30%)' :
                                                    markerSettings.markerStyle === 'pin' ? 'circle(40% at 50% 40%)' :
                                                        'none'
                                }} />
                                <div style={{
                                    marginLeft: '12px',
                                    fontSize: '11px',
                                    color: 'var(--light-600)',
                                    textAlign: 'left'
                                }}>
                                    <div>Size: {markerSettings.markerSize}px</div>
                                    <div>Style: {markerSettings.markerStyle || 'circle'}</div>
                                    <div>Opacity: {markerSettings.markerOpacity || 1}</div>
                                    {(markerSettings.markerAngle || 0) !== 0 && <div>Rotation: {markerSettings.markerAngle}°</div>}
                                </div>
                            </div>
                        </div>
                    </SettingRow>
                </SettingSection>
            )}

            {/* Text Settings - Only show if addText is enabled */}
            {enabledActions.addText && (
                <SettingSection title="Text Settings">
                    <SettingRow>
                        <div style={styles.sectionDescription}>
                            Configure how text appears when added to the map. Text graphics persist during the browser session.
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.settingsGrid}>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Font Size</label>
                                <NumericInput
                                    value={textSettings.fontSize}
                                    onChange={(value) => updateTextSetting('fontSize', value)}
                                    min={8}
                                    max={48}
                                    size="sm"
                                />
                            </div>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Font Family</label>
                                <Select
                                    value={textSettings.fontFamily || 'Arial'}
                                    onChange={(e) => updateTextSetting('fontFamily', e.target.value)}
                                    size="sm"
                                >
                                    <Option value="Arial">Arial</Option>
                                    <Option value="Helvetica">Helvetica</Option>
                                    <Option value="Times New Roman">Times New Roman</Option>
                                    <Option value="Courier New">Courier New</Option>
                                    <Option value="Georgia">Georgia</Option>
                                    <Option value="Verdana">Verdana</Option>
                                    <Option value="Tahoma">Tahoma</Option>
                                    <Option value="Trebuchet MS">Trebuchet MS</Option>
                                </Select>
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Font Weight</label>
                            <div role="radiogroup" style={styles.radioGroup}>
                                <label style={styles.radioLabel}>
                                    <Radio
                                        name="font-weight"
                                        value="normal"
                                        checked={textSettings.fontWeight === 'normal'}
                                        onChange={() => updateTextSetting('fontWeight', 'normal')}
                                    />
                                    Normal
                                </label>
                                <label style={styles.radioLabel}>
                                    <Radio
                                        name="font-weight"
                                        value="bold"
                                        checked={textSettings.fontWeight === 'bold' || !textSettings.fontWeight}
                                        onChange={() => updateTextSetting('fontWeight', 'bold')}
                                    />
                                    Bold
                                </label>
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Text Color</label>
                            <div style={styles.colorInputContainer}>
                                <input
                                    type="color"
                                    value={textSettings.fontColor}
                                    onChange={(e) => updateTextSetting('fontColor', e.target.value)}
                                    style={styles.colorPicker}
                                />
                                <TextInput
                                    value={textSettings.fontColor}
                                    onChange={(e) => updateTextSetting('fontColor', e.target.value)}
                                    placeholder="#000000"
                                    size="sm"
                                    style={{ flex: 1 }}
                                />
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Outline Color</label>
                            <div style={styles.colorInputContainer}>
                                <input
                                    type="color"
                                    value={textSettings.haloColor}
                                    onChange={(e) => updateTextSetting('haloColor', e.target.value)}
                                    style={styles.colorPicker}
                                />
                                <TextInput
                                    value={textSettings.haloColor}
                                    onChange={(e) => updateTextSetting('haloColor', e.target.value)}
                                    placeholder="#ffffff"
                                    size="sm"
                                    style={{ flex: 1 }}
                                />
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Outline Size</label>
                            <NumericInput
                                value={textSettings.haloSize}
                                onChange={(value) => updateTextSetting('haloSize', value)}
                                min={0}
                                max={6}
                                size="sm"
                                style={{ maxWidth: '120px' }}
                            />
                            <div style={styles.helpText}>
                                Set to 0 to disable text outline
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Background Color (optional)</label>
                            <div style={styles.colorInputContainer}>
                                <input
                                    type="color"
                                    value={textSettings.backgroundColor === 'transparent' ? '#ffffff' : textSettings.backgroundColor}
                                    onChange={(e) => updateTextSetting('backgroundColor', e.target.value)}
                                    style={styles.colorPicker}
                                />
                                <TextInput
                                    value={textSettings.backgroundColor}
                                    onChange={(e) => updateTextSetting('backgroundColor', e.target.value)}
                                    placeholder="transparent"
                                    size="sm"
                                    style={{ flex: 1 }}
                                />
                            </div>
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <Button
                                type="tertiary"
                                size="sm"
                                onClick={() => updateTextSetting('backgroundColor', 'transparent')}
                                style={{ alignSelf: 'flex-start' }}
                            >
                                Clear Background
                            </Button>
                            <div style={styles.helpText}>
                                Set to "transparent" for no background, or choose a color for text with background
                            </div>
                        </div>
                    </SettingRow>
                </SettingSection>
            )}

            {/* Pictometry Settings - Only show if pictometry is enabled */}
            {enabledActions.pictometry && (
                <SettingSection title="Pictometry Settings">
                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Pictometry URL</label>
                            <TextInput
                                style={{ width: '100%' }}
                                value={config.pictometryUrl || ''}
                                onChange={(e) => updatePictometryUrl(e.target.value)}
                                placeholder="https://example.com/gjPictViz.aspx"
                            />
                        </div>
                    </SettingRow>
                    {!config.pictometryUrl && (
                        <SettingRow>
                            <div style={styles.warningBox}>
                                <strong>Warning:</strong> Pictometry is enabled but no URL is configured. The right-click option will not work without a valid URL.
                            </div>
                        </SettingRow>
                    )}
                </SettingSection>
            )}

            {/* What's Here Service - Only show if whatsHere is enabled */}
            {enabledActions.whatsHere && (
                <SettingSection title="What's Here? Service">
                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Geocoding Service URL</label>
                            <TextInput
                                style={{ width: '100%' }}
                                value={config.reverseGeocodeUrl || ''}
                                onChange={(e) => updateWhatsHereUrl(e.target.value)}
                                placeholder="https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer"
                            />
                        </div>
                    </SettingRow>
                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Locator WKID</label>
                            <TextInput
                                style={{ width: '100%' }}
                                value={config.reverseGeocodeWkid?.toString() || ''}
                                onChange={(e) => updateReverseGeocodeWkid(e.target.value)}
                                placeholder="e.g. 3857"
                            />
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.settingsGrid}>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Max Results Per Layer</label>
                                <NumericInput
                                    value={config.whatsHereSettings?.maxResults || 10}
                                    onChange={(value) => updateWhatsHereSettings('maxResults', value)}
                                    min={1}
                                    max={50}
                                    size="sm"
                                />
                            </div>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Search Radius (meters)</label>
                                <NumericInput
                                    value={config.whatsHereSettings?.searchRadius || 10}
                                    onChange={(value) => updateWhatsHereSettings('searchRadius', value)}
                                    min={1}
                                    max={1000}
                                    size="sm"
                                />
                            </div>
                        </div>
                    </SettingRow>
                </SettingSection>
            )}

            {/* Feature Layers - Only show if whatsHere is enabled */}
            {enabledActions.whatsHere && (
                <SettingSection title="Feature Layers for What's Here?">
                    {(!config.featureLayers || config.featureLayers.length === 0) ? (
                        <SettingRow>
                            <div style={styles.emptyState}>
                                <div style={{ fontSize: '24px', marginBottom: '8px' }}>
                                    <Icon icon="widget-table" size={24} />
                                </div>
                                <div><strong>No feature layers configured</strong></div>
                                <div style={{ fontSize: '11px', marginTop: '4px' }}>
                                    Add feature layers to enhance the "What's Here?" functionality
                                </div>
                            </div>
                        </SettingRow>
                    ) : (
                        config.featureLayers.map((layer, index) => {
                            const layerFieldState = fieldStates[index];
                            const hasUrl = layer.url && layer.url.trim().length > 0;

                            const selectedFields = layer.fields || [];
                            const availableFields = layerFieldState?.fields || [];

                            return (
                                <SettingRow key={index}>
                                    <div style={styles.featureLayerContainer}>
                                        <div style={styles.featureLayerHeader}>
                                            <div style={styles.featureLayerTitle}>
                                                {layer.name || `Feature Layer ${index + 1}`}
                                            </div>
                                            <Button
                                                type="tertiary"
                                                size="sm"
                                                icon
                                                onClick={() => removeFeatureLayer(index)}
                                                style={styles.removeButton}
                                            >
                                                <TrashOutlined />
                                            </Button>
                                        </div>

                                        <div style={styles.featureLayerContent}>
                                            <div style={styles.fieldRow}>
                                                <label style={styles.inputLabel}>Layer Name</label>
                                                <TextInput
                                                    value={layer.name || ''}
                                                    onChange={(e) =>
                                                        updateFeatureLayer(index, {
                                                            ...layer,
                                                            name: e.target.value
                                                        })
                                                    }
                                                    placeholder="Display name for this layer"
                                                    size="sm"
                                                />
                                            </div>

                                            <div style={styles.fieldRow}>
                                                <label style={styles.inputLabel}>Feature Service URL</label>
                                                <div style={styles.urlInputContainer}>
                                                    <TextInput
                                                        style={{ flex: 1 }}
                                                        value={layer.url || ''}
                                                        onChange={(e) => {
                                                            const newUrl = e.target.value;
                                                            updateFeatureLayer(index, {
                                                                ...layer,
                                                                url: newUrl,
                                                                fields: []
                                                            });

                                                            if (layerFieldState) {
                                                                setFieldStates(prev => ({
                                                                    ...prev,
                                                                    [index]: { fields: [], loading: false, error: null }
                                                                }));
                                                            }
                                                        }}
                                                        placeholder="https://services.arcgis.com/.../FeatureServer/0"
                                                        size="sm"
                                                    />
                                                    {hasUrl && (
                                                        <Tooltip title="Load fields from service">
                                                            <Button
                                                                type="tertiary"
                                                                size="sm"
                                                                icon
                                                                onClick={() => fetchFieldsFromService(layer.url, index)}
                                                                disabled={layerFieldState?.loading}
                                                                style={styles.refreshButton}
                                                            >
                                                                <RefreshOutlined />
                                                            </Button>
                                                        </Tooltip>
                                                    )}
                                                </div>
                                            </div>

                                            <div style={styles.fieldRow}>
                                                <label style={{ ...styles.inputLabel, color: hasUrl ? styles.inputLabel.color : 'var(--light-500)' }}>
                                                    Fields to Display
                                                </label>

                                                {!hasUrl && (
                                                    <div style={styles.disabledText}>
                                                        Enter a Feature Service URL above to load available fields
                                                    </div>
                                                )}

                                                {hasUrl && !layerFieldState && (
                                                    <div style={styles.helpText}>
                                                        Click the refresh button to load fields from the service
                                                    </div>
                                                )}

                                                {layerFieldState?.loading && (
                                                    <div style={styles.loadingContainer}>
                                                        <Loading />
                                                        Loading fields from service...
                                                    </div>
                                                )}

                                                {layerFieldState?.error && (
                                                    <div style={styles.errorContainer}>
                                                        <strong>Error:</strong> {layerFieldState.error}
                                                    </div>
                                                )}

                                                {availableFields.length > 0 && (
                                                    <div style={styles.fieldSelectionContainer}>
                                                        <div style={styles.fieldSelectionHeader}>
                                                            Select fields to display ({selectedFields.length} of {availableFields.length} selected):
                                                        </div>

                                                        <div style={styles.fieldCheckboxList}>
                                                            {availableFields.map((field) => (
                                                                <div key={field.name} style={styles.fieldCheckboxItem}>
                                                                    <Checkbox
                                                                        checked={selectedFields.includes(field.name)}
                                                                        onChange={(e) => updateFieldSelection(index, field.name, e.target.checked)}
                                                                    />
                                                                    <div style={styles.fieldTextContainer}>
                                                                        <div style={styles.fieldName}>{field.name}</div>
                                                                        {field.alias !== field.name && (
                                                                            <div style={styles.fieldAlias}>{field.alias}</div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        <div style={styles.showAllContainer}>
                                                            <Button
                                                                type="tertiary"
                                                                size="sm"
                                                                onClick={() => toggleAllFields(index, true)}
                                                                disabled={selectedFields.length === availableFields.length}
                                                            >
                                                                Select All
                                                            </Button>
                                                            <Button
                                                                type="tertiary"
                                                                size="sm"
                                                                onClick={() => toggleAllFields(index, false)}
                                                                disabled={selectedFields.length === 0}
                                                            >
                                                                Clear All
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </SettingRow>
                            );
                        })
                    )}

                    <SettingRow flow="wrap">
                        <Button
                            type="primary"
                            size="sm"
                            icon
                            onClick={addFeatureLayer}
                        >
                            <PlusOutlined />
                            Add Feature Layer
                        </Button>
                    </SettingRow>
                </SettingSection>
            )}

            {/* Layer Selection — pick which layers feed What's Here at runtime */}
            {enabledActions.whatsHere && (
                <SettingSection title="What's Here? Layer Selection">
                    <SettingRow>
                        <div style={styles.sectionDescription}>
                            Choose which map layers participate in What's Here. By default every queryable layer is included. Toggling a group layer cascades to all layers nested beneath it.
                        </div>
                    </SettingRow>

                    {!(config.useMapWidgetIds && config.useMapWidgetIds.length > 0) ? (
                        <SettingRow>
                            <Alert form="basic" type="info" text="Select a map widget above first to load its layer tree." />
                        </SettingRow>
                    ) : !layerTreeReady ? (
                        <SettingRow>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--dark-600)', fontSize: '12px' }}>
                                <Loading width={16} height={16} />
                                Loading layers from the map…
                            </div>
                        </SettingRow>
                    ) : layerTree.length === 0 ? (
                        <SettingRow>
                            <Alert form="basic" type="warning" text="No layers found in the connected map." />
                        </SettingRow>
                    ) : (
                        <>
                            <SettingRow>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <Button size="sm" type="tertiary" onClick={selectAllLayers}>Select all</Button>
                                    <Button size="sm" type="tertiary" onClick={deselectAllLayers}>Deselect all</Button>
                                    <span style={{ ...styles.helpText, marginLeft: 'auto' }}>
                                        {(() => {
                                            const eff = getEffectiveSelection();
                                            const n = allLeafKeys.filter(k => eff.has(k)).length;
                                            return `${n} of ${allLeafKeys.length} layers selected`;
                                        })()}
                                    </span>
                                </div>
                            </SettingRow>
                            <SettingRow>
                                <div style={{ ...styles.helpText, padding: '4px 0' }}>
                                    Use the <strong>Trust</strong> button next to a group or map service to auto-include
                                    every nested layer — current and future. Trusted groups don&apos;t need individual
                                    layer checkboxes, and new layers added to the service later will be picked up
                                    automatically without re-saving these settings.
                                </div>
                            </SettingRow>
                            <SettingRow>
                                <div
                                    role="tree"
                                    style={{
                                        width: '100%',
                                        maxHeight: '320px',
                                        overflow: 'auto',
                                        border: '1px solid var(--light-400)',
                                        borderRadius: '4px',
                                        background: 'var(--white)',
                                        padding: '6px'
                                    }}
                                >
                                    {layerTree.map(node => (
                                        <LayerSelectionTreeNode
                                            key={node.key}
                                            node={node}
                                            depth={0}
                                            getNodeState={getNodeState}
                                            isLayerSelected={isLayerSelected}
                                            onToggle={toggleNode}
                                            collectLeafKeysUnder={collectLeafKeysUnder}
                                            isTrusted={isNodeTrusted}
                                            onTrustToggle={setNodeTrusted}
                                        />
                                    ))}
                                </div>
                            </SettingRow>
                        </>
                    )}
                </SettingSection>
            )}

            {/* What's Here? Highlight Style - color + outline for the
                on-map graphic drawn over a selected feature while its
                detail view is open. Only relevant when What's Here is on. */}
            {enabledActions.whatsHere && (() => {
                const hi: WhatsHereHighlightConfig = (config.whatsHereHighlight as any) || defaultWhatsHereHighlight;
                const fillEnabled = hi.fillEnabled === true;
                const fillColor = hi.fillColor || defaultWhatsHereHighlight.fillColor || '#0079c1';
                const outlineColor = hi.outlineColor || defaultWhatsHereHighlight.outlineColor || '#0079c1';
                const outlineWidth = typeof hi.outlineWidth === 'number' ? hi.outlineWidth : (defaultWhatsHereHighlight.outlineWidth || 2);
                // Shared style for the native <input type="color"> swatches.
                // Native picker UI varies by OS — keep the swatch compact and
                // align it with the rest of the form controls.
                const swatchStyle: React.CSSProperties = {
                    width: '40px',
                    height: '28px',
                    padding: 0,
                    border: '1px solid var(--light-400)',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    background: 'transparent'
                };
                return (
                    <SettingSection title="What's Here? Highlight Style">
                        <SettingRow>
                            <div style={styles.sectionDescription}>
                                How a selected feature is drawn on the map while its
                                detail view is open. Defaults to a 2px cyan outline
                                (Esri's standard selection colour) with no fill.
                                Polylines use only the outline; points use it as
                                their stroke.
                            </div>
                        </SettingRow>
                        <SettingRow label="Fill">
                            <Switch
                                checked={fillEnabled}
                                onChange={(e: any) => updateWhatsHereHighlight('fillEnabled', !!e?.target?.checked)}
                            />
                        </SettingRow>
                        <SettingRow label="Fill color">
                            <input
                                type="color"
                                value={fillColor}
                                disabled={!fillEnabled}
                                onChange={(e) => updateWhatsHereHighlight('fillColor', e.target.value)}
                                style={{ ...swatchStyle, opacity: fillEnabled ? 1 : 0.4 }}
                                title={fillEnabled ? 'Pick fill color' : 'Enable Fill to choose a color'}
                            />
                        </SettingRow>
                        <SettingRow label="Outline color">
                            <input
                                type="color"
                                value={outlineColor}
                                onChange={(e) => updateWhatsHereHighlight('outlineColor', e.target.value)}
                                style={swatchStyle}
                                title="Pick outline color"
                            />
                        </SettingRow>
                        <SettingRow label="Outline width (px)">
                            <NumericInput
                                value={outlineWidth}
                                min={1}
                                max={10}
                                step={1}
                                onChange={(v: number) => updateWhatsHereHighlight('outlineWidth', Math.max(1, Math.min(10, v || 2)))}
                                style={{ width: '70px' }}
                            />
                        </SettingRow>
                    </SettingSection>
                );
            })()}

            {/* Popup Display Settings - Only show if whatsHere is enabled */}
            {enabledActions.whatsHere && (
                <SettingSection title="Popup Display Settings">
                    <SettingRow>
                        <div style={styles.settingsGrid}>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Popup Max Height (px)</label>
                                <NumericInput
                                    value={config.uiSettings?.popupMaxHeight || 400}
                                    onChange={(value) => updateUISettings('popupMaxHeight', value)}
                                    min={200}
                                    max={800}
                                    size="sm"
                                />
                            </div>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Popup Width (px)</label>
                                <NumericInput
                                    value={config.uiSettings?.popupWidth || 300}
                                    onChange={(value) => updateUISettings('popupWidth', value)}
                                    min={250}
                                    max={500}
                                    size="sm"
                                />
                            </div>
                        </div>
                    </SettingRow>
                    <SettingRow>
                        <div style={styles.radioGroup}>
                            <label style={styles.radioLabel}>
                                <Switch
                                    checked={config.uiSettings?.showLayerNames !== false}
                                    onChange={(e) => updateUISettings('showLayerNames', e.target.checked)}
                                />
                                Show layer names in popup
                            </label>
                            <label style={styles.radioLabel}>
                                <Switch
                                    checked={config.uiSettings?.groupByLayer !== false}
                                    onChange={(e) => updateUISettings('groupByLayer', e.target.checked)}
                                />
                                Group results by layer
                            </label>
                            <label style={styles.radioLabel}>
                                <Switch
                                    checked={config.uiSettings?.showFieldAliases !== false}
                                    onChange={(e) => updateUISettings('showFieldAliases', e.target.checked)}
                                />
                                Use field aliases for display
                            </label>
                        </div>
                    </SettingRow>
                </SettingSection>
            )}

            {/* Popup Overrides (Arcade) - Only show if whatsHere is enabled */}
            {enabledActions.whatsHere && (
                <SettingSection title="Popup Overrides (Arcade)">
                    <SettingRow>
                        <div style={styles.sectionDescription}>
                            Replace the default attribute list for matching layers with custom HTML and Arcade-computed values. Each override matches by a substring of the layer's URL and/or title. Inside the HTML, use <code>{'{FIELDNAME}'}</code> for attribute values (HTML-escaped) and <code>{'{expression/name}'}</code> for Arcade results (rendered as HTML).
                        </div>
                    </SettingRow>

                    {((config.popupOverrides as any) || []).map((override: PopupOverrideConfig, idx: number) => (
                        <div
                            key={override.id || idx}
                            style={{
                                border: '1px solid var(--light-400)',
                                borderRadius: '4px',
                                padding: '10px',
                                marginBottom: '12px',
                                background: 'var(--light-200)',
                                boxSizing: 'border-box',
                                width: '100%',
                                maxWidth: '100%',
                                minWidth: 0,
                                overflow: 'hidden'
                            }}
                        >
                            {/* Card header: enabled toggle + title + remove */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', minWidth: 0 }}>
                                <Switch
                                    checked={override.enabled !== false}
                                    onChange={(e) => updatePopupOverride(idx, { enabled: e.target.checked })}
                                />
                                <span
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        fontWeight: 600,
                                        fontSize: '13px',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}
                                    title={override.title || `Override #${idx + 1}`}
                                >
                                    Override #{idx + 1}{override.title ? ` — ${override.title}` : ''}
                                </span>
                                <Tooltip title="Remove this override" placement="top">
                                    <Button size="sm" type="tertiary" onClick={() => removePopupOverride(idx)} aria-label="Remove override">
                                        <TrashOutlined />
                                    </Button>
                                </Tooltip>
                            </div>

                            {/* Match fields — single column so they don't get cut off in narrow panels.
                                Leaving both blank applies the override to every layer; if either is
                                set it's used as a case-insensitive substring filter, and if both are
                                set both must match. */}
                            <div style={{ ...styles.inputContainer, marginBottom: '10px' }}>
                                <label style={styles.inputLabel}>Match URL contains</label>
                                <TextInput
                                    size="sm"
                                    value={override.matchUrl || ''}
                                    placeholder="e.g. /Parcels/FeatureServer/0"
                                    onChange={(e) => updatePopupOverride(idx, { matchUrl: e.target.value })}
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <div style={{ ...styles.inputContainer, marginBottom: '6px' }}>
                                <label style={styles.inputLabel}>Match Layer Title contains</label>
                                <TextInput
                                    size="sm"
                                    value={override.matchTitle || ''}
                                    placeholder="e.g. Parcels"
                                    onChange={(e) => updatePopupOverride(idx, { matchTitle: e.target.value })}
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <div style={{ fontSize: '11px', color: 'var(--light-600)', fontStyle: 'italic', marginBottom: '10px', lineHeight: 1.4 }}>
                                Leave both blank to apply this override to every layer. More-specific
                                overrides (with a URL or title filter) take precedence over a blank one.
                            </div>

                            <div style={{ ...styles.inputContainer, marginBottom: '10px' }}>
                                <label style={styles.inputLabel}>Header title (optional)</label>
                                <TextInput
                                    size="sm"
                                    value={override.title || ''}
                                    placeholder="Leave blank to use the layer name"
                                    onChange={(e) => updatePopupOverride(idx, { title: e.target.value })}
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <div style={{ ...styles.inputContainer, marginBottom: '10px' }}>
                                <label style={styles.inputLabel}>Content (HTML)</label>
                                <textarea
                                    value={override.content || ''}
                                    onChange={(e) => updatePopupOverride(idx, { content: e.target.value })}
                                    rows={8}
                                    spellCheck={false}
                                    style={{
                                        width: '100%',
                                        maxWidth: '100%',
                                        minWidth: 0,
                                        fontFamily: 'Consolas, Monaco, monospace',
                                        fontSize: '12px',
                                        padding: '6px 8px',
                                        border: '1px solid var(--light-400)',
                                        borderRadius: '3px',
                                        resize: 'vertical',
                                        boxSizing: 'border-box',
                                        lineHeight: '1.4',
                                        display: 'block'
                                    }}
                                />
                                <div style={styles.helpText}>
                                    Use <code>{'{FIELDNAME}'}</code> for attributes and <code>{'{expression/name}'}</code> for Arcade results.
                                </div>
                            </div>

                            {/* Arcade expressions sub-section */}
                            <div style={{ borderTop: '1px solid var(--light-400)', paddingTop: '10px', marginTop: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', minWidth: 0 }}>
                                    <label style={{ ...styles.inputLabel, margin: 0, flex: 1, minWidth: 0 }}>Arcade expressions</label>
                                    <Button size="sm" type="tertiary" onClick={() => addOverrideExpression(idx)}>
                                        <PlusOutlined /> Add
                                    </Button>
                                </div>

                                {(override.expressionInfos || []).length === 0 ? (
                                    <div style={styles.helpText}>No expressions defined. Add one to compute values for use in the content template via <code>{'{expression/<name>}'}</code>.</div>
                                ) : (
                                    (override.expressionInfos || []).map((expr, eIdx) => (
                                        <div
                                            key={eIdx}
                                            style={{
                                                border: '1px solid var(--light-400)',
                                                borderRadius: '3px',
                                                padding: '8px',
                                                marginBottom: '8px',
                                                background: 'var(--white)',
                                                boxSizing: 'border-box',
                                                maxWidth: '100%',
                                                minWidth: 0,
                                                overflow: 'hidden'
                                            }}
                                        >
                                            {/* Header row: expression name + remove button */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', minWidth: 0 }}>
                                                <span
                                                    style={{
                                                        flex: 1,
                                                        minWidth: 0,
                                                        fontSize: '12px',
                                                        fontWeight: 600,
                                                        color: 'var(--dark-700)',
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis'
                                                    }}
                                                    title={expr.name || `expression #${eIdx + 1}`}
                                                >
                                                    Expression: <code>{expr.name || `expr${eIdx + 1}`}</code>
                                                </span>
                                                <Tooltip title="Remove expression" placement="top">
                                                    <Button size="sm" type="tertiary" onClick={() => removeOverrideExpression(idx, eIdx)} aria-label="Remove expression">
                                                        <TrashOutlined />
                                                    </Button>
                                                </Tooltip>
                                            </div>

                                            {/* All meta fields stacked vertically — fits a narrow panel cleanly */}
                                            <div style={{ ...styles.inputContainer, marginBottom: '8px' }}>
                                                <label style={styles.inputLabel}>Name</label>
                                                <TextInput
                                                    size="sm"
                                                    value={expr.name || ''}
                                                    placeholder="myValue"
                                                    onChange={(e) => updateOverrideExpression(idx, eIdx, { name: e.target.value })}
                                                    style={{ width: '100%' }}
                                                />
                                            </div>
                                            <div style={{ ...styles.inputContainer, marginBottom: '8px' }}>
                                                <label style={styles.inputLabel}>Title (optional)</label>
                                                <TextInput
                                                    size="sm"
                                                    value={expr.title || ''}
                                                    placeholder="Friendly label"
                                                    onChange={(e) => updateOverrideExpression(idx, eIdx, { title: e.target.value })}
                                                    style={{ width: '100%' }}
                                                />
                                            </div>
                                            <div style={{ ...styles.inputContainer, marginBottom: '8px' }}>
                                                <label style={styles.inputLabel}>Return type</label>
                                                <Select
                                                    size="sm"
                                                    value={expr.returnType || 'string'}
                                                    onChange={(e: any) => updateOverrideExpression(idx, eIdx, { returnType: e.target.value })}
                                                    style={{ width: '100%' }}
                                                >
                                                    <Option value="string">string</Option>
                                                    <Option value="number">number</Option>
                                                    <Option value="date">date</Option>
                                                    <Option value="boolean">boolean</Option>
                                                </Select>
                                            </div>
                                            <div style={styles.inputContainer}>
                                                <label style={styles.inputLabel}>Expression</label>
                                                <textarea
                                                    value={expr.expression || ''}
                                                    onChange={(e) => updateOverrideExpression(idx, eIdx, { expression: e.target.value })}
                                                    rows={5}
                                                    spellCheck={false}
                                                    placeholder="// Arcade — $feature is available&#10;return $feature.OBJECTID;"
                                                    style={{
                                                        width: '100%',
                                                        maxWidth: '100%',
                                                        minWidth: 0,
                                                        fontFamily: 'Consolas, Monaco, monospace',
                                                        fontSize: '12px',
                                                        padding: '6px 8px',
                                                        border: '1px solid var(--light-400)',
                                                        borderRadius: '3px',
                                                        resize: 'vertical',
                                                        boxSizing: 'border-box',
                                                        lineHeight: '1.4',
                                                        display: 'block'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    ))}

                    <SettingRow>
                        <Button onClick={addPopupOverride} type="primary" size="sm">
                            <PlusOutlined /> Add Popup Override
                        </Button>
                    </SettingRow>

                    {((config.popupOverrides as any) || []).length === 0 && (
                        <SettingRow>
                            <div style={styles.helpText}>
                                No overrides yet. The default attribute list will be shown for every layer.
                            </div>
                        </SettingRow>
                    )}
                </SettingSection>
            )}

            {/* Coordinate System - Only show if copyCoordinates is enabled */}
            {enabledActions.copyCoordinates && (
                <SettingSection title="Copy Coordinates Settings">
                    <SettingRow>
                        <div style={styles.sectionDescription}>
                            Configure the coordinate system and format for the Copy Coordinates action.
                        </div>
                    </SettingRow>

                    <SettingRow>
                        <div style={styles.inputContainer}>
                            <label style={styles.inputLabel}>Coordinate System</label>
                            <div role="radiogroup" style={styles.radioGroup}>
                                <label style={styles.radioLabel}>
                                    <Radio
                                        name="copy-coord-system"
                                        value="map"
                                        checked={copySettings.coordinateSystem === 'map' || !copySettings.coordinateSystem}
                                        onChange={() => updateCopySetting('coordinateSystem', 'map')}
                                    />
                                    Use Map's Native Coordinate System
                                </label>
                                <label style={styles.radioLabel}>
                                    <Radio
                                        name="copy-coord-system"
                                        value="webMercator"
                                        checked={copySettings.coordinateSystem === 'webMercator'}
                                        onChange={() => updateCopySetting('coordinateSystem', 'webMercator')}
                                    />
                                    Lat/Lon (WGS84)
                                </label>
                                <label style={styles.radioLabel}>
                                    <Radio
                                        name="copy-coord-system"
                                        value="custom"
                                        checked={copySettings.coordinateSystem === 'custom'}
                                        onChange={() => updateCopySetting('coordinateSystem', 'custom')}
                                    />
                                    Custom Coordinate System
                                </label>
                            </div>
                        </div>
                    </SettingRow>

                    {copySettings.coordinateSystem === 'custom' && (
                        <SettingRow>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Custom WKID</label>
                                <NumericInput
                                    value={copySettings.customWkid || ''}
                                    onChange={(value) => updateCopySetting('customWkid', value)}
                                    placeholder="e.g. 3857, 4326, 2154"
                                    size="sm"
                                />
                                <div style={styles.helpText}>
                                    Enter the WKID (Well-Known ID) for your desired coordinate system
                                </div>
                            </div>
                        </SettingRow>
                    )}

                    {copySettings.coordinateSystem === 'webMercator' && (
                        <SettingRow>
                            <div style={styles.settingsGrid}>
                                <div style={styles.inputContainer}>
                                    <label style={styles.inputLabel}>Lat/Lon Format</label>
                                    <div role="radiogroup" style={styles.radioGroup}>
                                        <label style={styles.radioLabel}>
                                            <Radio
                                                name="copy-coord-format"
                                                value="decimal"
                                                checked={copySettings.coordinateFormat === 'decimal' || !copySettings.coordinateFormat}
                                                onChange={() => updateCopySetting('coordinateFormat', 'decimal')}
                                            />
                                            Decimal Degrees
                                        </label>
                                        <label style={styles.radioLabel}>
                                            <Radio
                                                name="copy-coord-format"
                                                value="dms"
                                                checked={copySettings.coordinateFormat === 'dms'}
                                                onChange={() => updateCopySetting('coordinateFormat', 'dms')}
                                            />
                                            Degrees, Minutes, Seconds
                                        </label>
                                    </div>
                                </div>
                                <div style={styles.inputContainer}>
                                    <label style={styles.inputLabel}>Decimal Places</label>
                                    <NumericInput
                                        value={copySettings.decimalPlaces || 6}
                                        onChange={(value) => updateCopySetting('decimalPlaces', value)}
                                        min={0}
                                        max={10}
                                        size="sm"
                                        disabled={copySettings.coordinateFormat === 'dms'}
                                    />
                                </div>
                            </div>
                        </SettingRow>
                    )}

                    {(copySettings.coordinateSystem === 'map' || copySettings.coordinateSystem === 'custom' || !copySettings.coordinateSystem) && (
                        <SettingRow>
                            <div style={styles.inputContainer}>
                                <label style={styles.inputLabel}>Decimal Places</label>
                                <NumericInput
                                    value={copySettings.decimalPlaces || 2}
                                    onChange={(value) => updateCopySetting('decimalPlaces', value)}
                                    min={0}
                                    max={10}
                                    size="sm"
                                />
                            </div>
                        </SettingRow>
                    )}
                </SettingSection>
            )}

            {/* Measurement Settings - Only show if measurement actions are enabled */}
            {isMeasurementEnabled && (
                <SettingSection title="Measurement Settings">
                    <SettingRow>
                        <div style={styles.sectionDescription}>
                            Configure measurement units and display options.
                        </div>
                    </SettingRow>
                    <SettingRow>
                        <div style={styles.measurementContainer}>
                            <div style={styles.measurementLabel}>Default Units:</div>
                            <div role="radiogroup" style={styles.measurementRadioGroup}>
                                {unitOptions.map(unit => (
                                    <label key={unit} style={styles.radioLabel}>
                                        <Radio
                                            name="default-units"
                                            value={unit}
                                            checked={measurementSettings.defaultUnits === unit}
                                            onChange={() => updateMeasurementSetting('defaultUnits', unit)}
                                        />
                                        {unit.charAt(0).toUpperCase() + unit.slice(1)}
                                    </label>
                                ))}
                            </div>
                        </div>
                    </SettingRow>
                    <SettingRow style={{ marginTop: '20px' }}>
                        <div style={styles.measurementContainer}>
                            <div style={styles.measurementLabel}>Unit Display:</div>

                            <div role="radiogroup" style={styles.measurementRadioGroup}>
                                <label style={styles.radioLabel}>
                                    <Radio
                                        name="unit-display"
                                        value="single"
                                        checked={measurementSettings.unitDisplay === 'single' || !measurementSettings.unitDisplay}
                                        onChange={() => updateMeasurementSetting('unitDisplay', 'single')}
                                    />
                                    Single Unit Only
                                </label>
                                <label style={styles.radioLabel}>
                                    <Radio
                                        name="unit-display"
                                        value="both"
                                        checked={measurementSettings.unitDisplay === 'both'}
                                        onChange={() => updateMeasurementSetting('unitDisplay', 'both')}
                                    />
                                    Show Both Units
                                </label>
                            </div>
                        </div>
                    </SettingRow>
                </SettingSection>
            )}

            {/* Mobile Long Press Settings - controls touch long-press
                behavior for phones and tablets. The long-press opens the
                same context menu that right-click opens on desktop. */}
            <SettingSection title="Mobile Long Press">
                <SettingRow>
                    <div style={styles.sectionDescription}>
                        On touch devices (phones and tablets), press and hold on the map to open the right-click context menu. Drag to cancel.
                    </div>
                </SettingRow>
                <SettingRow label="Enable long-press on touch devices">
                    <Switch
                        checked={longPressSettings.enabled !== false}
                        onChange={(e) => updateLongPressSetting('enabled', e.target.checked)}
                    />
                </SettingRow>
                <SettingRow label="Hold duration (ms)">
                    <NumericInput
                        value={longPressSettings.durationMs}
                        min={200}
                        max={2000}
                        step={50}
                        onChange={(value) => {
                            // NumericInput emits the new number directly.
                            // Reject empty or non-numeric inputs (which arrive
                            // as undefined) so we don't blow away the default.
                            if (typeof value === 'number' && value >= 200 && value <= 2000) {
                                updateLongPressSetting('durationMs', value);
                            }
                        }}
                        disabled={longPressSettings.enabled === false}
                    />
                </SettingRow>
                <SettingRow label="Movement threshold (px)">
                    <NumericInput
                        value={longPressSettings.moveThresholdPx}
                        min={3}
                        max={40}
                        step={1}
                        onChange={(value) => {
                            if (typeof value === 'number' && value >= 3 && value <= 40) {
                                updateLongPressSetting('moveThresholdPx', value);
                            }
                        }}
                        disabled={longPressSettings.enabled === false}
                    />
                </SettingRow>
                <SettingRow>
                    <div style={{ ...styles.sectionDescription, fontSize: '11px', fontStyle: 'italic' }}>
                        If the finger moves more than the threshold before the duration elapses, the gesture is treated as a pan and the menu does not open.
                    </div>
                </SettingRow>
            </SettingSection>
        </div>
    );
};

export default Setting;