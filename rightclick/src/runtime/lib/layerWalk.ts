// layerWalk.ts
// City of Grand Junction GIS Division
//
// Which map layers count as "on" at this moment, and how to query them so the
// answer matches what the map draws. Used by What's Here and by feature-scoped
// custom actions, so both always follow the same layers the person sees.
//
// The rule is the one Esri's Map Layers widget (and the GIS Division's Map
// Layers Custom fork) shows in its list:
//   - the layer and every group or map service above it is switched on
//     (a group with visibilityMode "inherited" decides for its children),
//   - the layer and every ancestor draws at the current scale,
//   - the layer is not a basemap or ground layer, and not hidden from the
//     layer list (listMode "hide", which is how widgets mark helper layers).
//
// Nothing here is cached. Every call reads the live map, so a layer switched
// on or off in any layer list, added at runtime, or brought into range by a
// zoom is picked up on the next right click.
//
// Pure TypeScript with no Experience Builder or Maps SDK imports, so the tests
// can load it in Node with plain objects standing in for layers.

import { computeLayerSelectionKey } from '../../config'

/** One layer that can be queried at a point. */
export interface QueryableLayerEntry {
    /** Layer title as the layer list shows it. */
    name: string
    /** Titles from the top group down to this layer, joined with " / ". */
    titlePath: string
    /** The live layer (FeatureLayer, map service Sublayer, SubtypeGroupLayer, GeoJSONLayer, ...). */
    mapLayer: any
    /** REST URL when the layer has one (a sublayer's is service URL + id). */
    layerUrl: string
    popupEnabled: boolean
    /** Extra SQL for a subtype group layer: only the subtypes that are switched on. */
    extraWhere?: string
    /** Stable key for de-duplication and change detection. */
    key: string
}

export interface CollectOptions {
    /** The view's current scale. 0 or missing skips scale checks. */
    scale?: number
    /** Returns the layer view for a top-level or group-member layer, when the view has one. */
    layerViewFor?: (layer: any) => any
    /** Last word on eligibility (What's Here layer selection). Return false to skip. */
    include?: (layer: any) => boolean
}

// declaredClass values that end the walk up the parent chain.
const MAP_ROOTS = new Set(['esri.Map', 'esri.WebMap', 'esri.WebScene'])
const NON_OPERATIONAL_ROOTS = new Set(['esri.Basemap', 'esri.Ground'])

/** Array from a Maps SDK Collection, a plain array, or nothing. */
export const itemsOf = (c: any): any[] => {
    if (!c) return []
    if (Array.isArray(c)) return c
    // Reading `length` first lets a reactiveUtils watcher notice layers being
    // added to or removed from a Collection.
    void c.length
    if (typeof c.toArray === 'function') { try { return c.toArray() } catch (e) { /* fall through */ } }
    return Array.isArray(c.items) ? c.items : []
}

/** The next node up: a sublayer's parent sublayer or service, a layer's group or map. */
const parentOf = (node: any): any => {
    if (!node) return null
    const p = node.parent
    if (p && p !== node) return p
    // Map service sublayers also carry `layer` (the MapImageLayer / TileLayer).
    const l = node.layer
    return l && l !== node ? l : null
}

const classOf = (node: any): string => String(node?.declaredClass || '')

/** Ancestors from the direct parent up to (not including) the map. */
export const ancestorsOf = (node: any): any[] => {
    const out: any[] = []
    let cur = parentOf(node)
    let hops = 0
    while (cur && hops < 60) {
        if (MAP_ROOTS.has(classOf(cur))) break
        out.push(cur)
        cur = parentOf(cur)
        hops++
    }
    return out
}

/** True when the layer belongs to a basemap or the ground, not the operational layers. */
export const isNonOperational = (node: any): boolean =>
    ancestorsOf(node).some((a) => NON_OPERATIONAL_ROOTS.has(classOf(a)))

/**
 * Switched on, all the way up. A group layer whose visibilityMode is
 * "inherited" overrides its children's own flags (Esri draws them whenever the
 * group is on), so a child's `visible: false` under such a group still counts
 * as on.
 */
export const isSwitchedOn = (node: any): boolean => {
    if (!node) return false
    const chain = [node, ...ancestorsOf(node)]
    for (let i = 0; i < chain.length; i++) {
        const cur = chain[i]
        if (NON_OPERATIONAL_ROOTS.has(classOf(cur))) break
        const parent = chain[i + 1]
        const inheritedFromParent = parent && parent.visibilityMode === 'inherited'
        if (!inheritedFromParent && cur.visible === false) return false
    }
    return true
}

/** Esri scale range check for one node. minScale is the zoomed-out limit, maxScale the zoomed-in one; 0 means no limit. */
export const nodeInScale = (node: any, scale: number): boolean => {
    if (!scale || !node) return true
    const min = Number(node.minScale || 0)
    const max = Number(node.maxScale || 0)
    if (min > 0 && scale > min) return false
    if (max > 0 && scale < max) return false
    return true
}

/** Draws at this scale: the layer itself and every group or service above it. */
export const isInScale = (node: any, scale: number): boolean => {
    if (!scale) return true
    if (!nodeInScale(node, scale)) return false
    return ancestorsOf(node).every((a) => nodeInScale(a, scale))
}

// Exact class match: 'esri.layers.SubtypeGroupLayer' also contains "GroupLayer".
const isGroupLayer = (l: any): boolean => l?.type === 'group' || classOf(l) === 'esri.layers.GroupLayer'
const isMapService = (l: any): boolean => {
    const t = String(l?.type || '')
    const c = classOf(l)
    return t === 'map-image' || t === 'tile' || c.indexOf('MapImageLayer') >= 0 || c.indexOf('TileLayer') >= 0
}
const isSubtypeGroup = (l: any): boolean => l?.type === 'subtype-group' || classOf(l).indexOf('SubtypeGroupLayer') >= 0

/** Quote one subtype code for SQL. Numbers stay bare; strings are single-quoted with quotes doubled. */
const sqlLiteral = (v: any): string =>
    typeof v === 'number' && isFinite(v) ? String(v) : `'${String(v).replace(/'/g, "''")}'`

/**
 * SQL limiting a subtype group layer to the subtypes switched on in the layer
 * list. '' when every subtype is on (no filter needed), null when none is on
 * (skip the layer).
 */
export const subtypeWhere = (layer: any): string | null => {
    const subs = itemsOf(layer?.sublayers)
    const field = String(layer?.subtypeField || '')
    if (!subs.length || !field) return ''
    const on = subs.filter((s: any) => s && s.visible !== false)
    if (!on.length) return null
    if (on.length === subs.length) return ''
    const codes = on.map((s: any) => s.subtypeCode).filter((c: any) => c !== undefined && c !== null)
    if (!codes.length) return ''
    return `${field} IN (${codes.map(sqlLiteral).join(', ')})`
}

/** REST URL for a layer or a map service sublayer. */
export const layerUrlOf = (layer: any): string => {
    if (layer?.url) {
        const u = String(layer.url)
        // A FeatureLayer may keep the service URL in `url` and its index in `layerId`.
        if (typeof layer.layerId === 'number' && !/\/\d+\/?$/.test(u)) return `${u.replace(/\/+$/, '')}/${layer.layerId}`
        return u
    }
    const svc = layer?.layer?.url || layer?.parent?.url
    if (svc && layer?.id !== undefined && layer?.id !== null) return `${String(svc).replace(/\/+$/, '')}/${layer.id}`
    return ''
}

/**
 * Every layer that is switched on, in range, and queryable, topmost first
 * (the order the layer list shows). Group layers, map services and group
 * sublayers are walked to any depth; only their queryable leaves are
 * returned.
 */
export const collectQueryableLayers = (map: any, opts: CollectOptions = {}): QueryableLayerEntry[] => {
    const scale = Number(opts.scale || 0)
    const out: QueryableLayerEntry[] = []
    const seen = new Set<string>()

    const layerViewOk = (layer: any): boolean => {
        if (!opts.layerViewFor) return true
        let lv: any = null
        try { lv = opts.layerViewFor(layer) } catch (e) { lv = null }
        if (!lv) return true
        // The layer view knows what actually draws; trust it when it says no.
        if (lv.visibleAtCurrentScale === false) return false
        if (lv.visibleAtCurrentTimeExtent === false) return false
        return true
    }

    const push = (layer: any, fallbackName: string, parents: string[], extraWhere?: string) => {
        if (!layer || typeof layer.queryFeatures !== 'function') return
        if (opts.include && !opts.include(layer)) return
        const url = layerUrlOf(layer)
        const key = (url || `${classOf(layer) || 'layer'}::${layer.uid ?? layer.id ?? fallbackName}`).toLowerCase() + (extraWhere ? `::${extraWhere}` : '')
        if (seen.has(key)) return
        seen.add(key)
        const name = String(layer.title || fallbackName || '')
        out.push({
            name,
            titlePath: [...parents, name].filter(Boolean).join(' / '),
            mapLayer: layer,
            layerUrl: url,
            popupEnabled: layer.popupEnabled !== false,
            extraWhere: extraWhere || undefined,
            key
        })
    }

    // Map service sublayers. A group sublayer holds more sublayers to any
    // depth; only leaves can be queried. A sublayer that is off, or out of
    // range, takes its children with it.
    const walkSub = (sub: any, depth: number, parents: string[]) => {
        if (!sub || depth > 60) return
        if (sub.visible === false) return
        if (!nodeInScale(sub, scale)) return
        const title = String(sub.title || '')
        const kids = itemsOf(sub.sublayers)
        if (kids.length) {
            // Draw order is bottom to top; list order is top first.
            for (const k of kids.slice().reverse()) walkSub(k, depth + 1, [...parents, title])
            return
        }
        push(sub, title, parents)
    }

    const walkLayer = (layer: any, depth: number, parents: string[]) => {
        if (!layer || depth > 60) return
        if (layer.listMode === 'hide') return
        if (layer.visible === false && !(layer.parent && layer.parent.visibilityMode === 'inherited')) return
        if (!nodeInScale(layer, scale)) return
        if (!layerViewOk(layer)) return
        const title = String(layer.title || layer.id || '')

        if (isGroupLayer(layer)) {
            for (const c of itemsOf(layer.layers).slice().reverse()) walkLayer(c, depth + 1, [...parents, title])
            return
        }
        if (isMapService(layer)) {
            for (const s of itemsOf(layer.sublayers).slice().reverse()) walkSub(s, depth + 1, [...parents, title])
            return
        }
        if (isSubtypeGroup(layer)) {
            const where = subtypeWhere(layer)
            if (where === null) return
            push(layer, title, parents, where)
            return
        }
        push(layer, title, parents)
    }

    for (const layer of itemsOf(map?.layers).slice().reverse()) walkLayer(layer, 0, [])
    return out
}

/**
 * A short string that changes whenever the set of queryable layers changes:
 * a layer switched on or off, added or removed, or crossing its scale range.
 * Used to refresh an open What's Here list without re-querying on every frame
 * of a zoom.
 */
export const layerSetSignature = (entries: QueryableLayerEntry[]): string =>
    entries.map((e) => e.key).join('|')

/** Join SQL conditions with AND, skipping empty ones and the always-true '1=1'. */
export const andWhere = (...parts: Array<string | null | undefined>): string => {
    const real = parts.map((p) => String(p || '').trim()).filter((p) => p && p !== '1=1')
    if (!real.length) return '1=1'
    if (real.length === 1) return real[0]
    return real.map((p) => `(${p})`).join(' AND ')
}

export interface PointQueryOptions {
    point: any
    /** Search distance around the point, in meters. 0 or missing: exact intersect. */
    distanceMeters?: number
    maxResults?: number
    orderBy?: string
    /** The layer's view, for a filter applied in the app (for example by a Filter widget). */
    layerView?: any
    /** The view's time extent, used for time-aware layers that follow view time. */
    viewTimeExtent?: any
    /** Extra SQL (subtype filter). */
    extraWhere?: string
}

/**
 * A query for the features under a point that respects everything that shapes
 * what the layer draws: its definition expression, its gdbVersion and own time
 * settings (all carried by layer.createQuery()), a filter set on its layer
 * view, the subtypes switched on, and the view's time slider.
 */
export const buildPointQuery = (layer: any, o: PointQueryOptions): any => {
    let q: any = null
    try { if (layer && typeof layer.createQuery === 'function') q = layer.createQuery() } catch (e) { q = null }
    if (!q || typeof q !== 'object') q = {}

    const viewFilterWhere = o.layerView?.filter?.where
    q.where = andWhere(q.where, viewFilterWhere, o.extraWhere)
    q.geometry = o.point
    q.spatialRelationship = 'intersects'
    q.outFields = ['*']
    // Geometry is needed for the highlight and Zoom to.
    q.returnGeometry = true
    if (o.maxResults && o.maxResults > 0) q.num = o.maxResults
    if (o.distanceMeters && o.distanceMeters > 0) {
        q.distance = o.distanceMeters
        q.units = 'meters'
    }
    if (o.orderBy) q.orderByFields = [o.orderBy]
    if (!q.timeExtent && o.viewTimeExtent && layer?.timeInfo && layer.useViewTime !== false) {
        q.timeExtent = o.viewTimeExtent
    }
    return q
}

/** The What's Here layer selection from the widget config (see WhatsHereLayerSelection in config.ts). */
export interface LayerSelection {
    mode?: string
    excludedKeys?: string[]
    selectedKeys?: string[]
    trustedGroupKeys?: string[]
}

/** True when the node's selection key, raw id or title is in the set. */
const nodeMatches = (node: any, keys: Set<string>): boolean => {
    if (!node || keys.size === 0) return false
    const k = computeLayerSelectionKey(node)
    if (k && keys.has(k)) return true
    const id = node.id !== undefined && node.id !== null ? String(node.id) : ''
    if (id && keys.has(id)) return true
    const title = node.title ? String(node.title) : ''
    return !!title && keys.has(title)
}

/** The node or any group or service above it matches. */
const chainMatches = (node: any, keys: Set<string>): boolean =>
    [node, ...ancestorsOf(node)].some((n) => nodeMatches(n, keys))

/** Every node in a top-level layer's tree: groups, members, map service sublayers at any depth. */
const subtreeOf = (root: any): any[] => {
    const out: any[] = []
    const walk = (n: any, depth: number) => {
        if (!n || depth > 60) return
        out.push(n)
        for (const c of itemsOf(n.layers)) walk(c, depth + 1)
        for (const c of itemsOf(n.sublayers)) walk(c, depth + 1)
    }
    walk(root, 0)
    return out
}

/** The top-level map layer a node sits under (the node itself when it is top level). */
const rootOf = (node: any): any => {
    const anc = ancestorsOf(node)
    return anc.length ? anc[anc.length - 1] : node
}

/**
 * A filter for collectQueryableLayers built from the What's Here layer
 * selection, worked out once per walk.
 *
 * Old include lists (mode 'selected', saved before 2.4.0) name layers by
 * their web map layer id. When a layer is removed from the web map and added
 * back, it gets a new id and the list no longer names anything in it, which
 * used to hide that whole layer from What's Here. So a top-level layer whose
 * tree the list does not mention at all is treated as new and searched; the
 * list still applies to every layer it does mention.
 */
export const makeSelectionFilter = (map: any, sel: LayerSelection | null | undefined): ((layer: any) => boolean) => {
    if (!sel || sel.mode !== 'selected' || !(sel.selectedKeys || []).length) {
        return (layer: any) => selectionAllows(layer, sel)
    }
    const saved = new Set([...(sel.selectedKeys || []), ...(sel.trustedGroupKeys || [])].map(String))
    // Composite sublayer keys also name their service.
    for (const k of Array.from(saved)) if (k.indexOf('::sub::') > 0) saved.add(k.slice(0, k.indexOf('::sub::')))
    const known = new Map<any, boolean>()
    for (const root of itemsOf(map?.layers)) known.set(root, subtreeOf(root).some((n) => nodeMatches(n, saved)))
    return (layer: any) => {
        const root = rootOf(layer)
        if (known.has(root) && !known.get(root)) return true
        return selectionAllows(layer, sel)
    }
}

/**
 * Whether the What's Here layer selection lets this layer be searched.
 * 'all' or nothing: yes. 'excluded': yes unless the layer or a group above it
 * is listed. 'selected' (configs saved before 2.4.0): only listed layers, a
 * listed group's layers, a trusted group's layers, or new sublayers of a
 * listed map service.
 */
export const selectionAllows = (layer: any, sel: LayerSelection | null | undefined): boolean => {
    if (!sel || !sel.mode || sel.mode === 'all') return true
    if (sel.mode === 'excluded') {
        const out = new Set((sel.excludedKeys || []).map(String))
        return !chainMatches(layer, out)
    }
    if (sel.mode !== 'selected') return true
    const allowed = (sel.selectedKeys || []).map(String)
    if (!allowed.length) return true
    if (chainMatches(layer, new Set((sel.trustedGroupKeys || []).map(String)))) return true
    if (chainMatches(layer, new Set(allowed))) return true
    // A sublayer added to a listed map service after the list was saved.
    const serviceIds = new Set(allowed.filter((k) => k.indexOf('::sub::') > 0).map((k) => k.slice(0, k.indexOf('::sub::'))))
    if (!serviceIds.size) return false
    const owner = ancestorsOf(layer).find(isMapService)
    return !!owner && owner.id !== undefined && serviceIds.has(String(owner.id))
}
