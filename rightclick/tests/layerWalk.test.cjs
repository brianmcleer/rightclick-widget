'use strict'
// Which layers What's Here searches (src/runtime/lib/layerWalk.ts). Plain
// objects stand in for Maps SDK layers: the module only reads properties.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./helpers/load.cjs')

const lw = loadTs('runtime/lib/layerWalk.ts')

let uid = 0
// Build a web map from a plain tree and wire `parent` (and `layer` for
// sublayers) the way the Maps SDK does.
function webmap (layers) {
  const map = { declaredClass: 'esri.WebMap', layers }
  const wire = (node, parent, service) => {
    node.parent = parent
    if (node.uid === undefined) node.uid = `u${++uid}`
    if (service) node.layer = service
    for (const c of node.layers || []) wire(c, node, null)
    for (const s of node.sublayers || []) wire(s, node, node.type === 'map-image' ? node : service)
  }
  for (const l of layers) wire(l, map, null)
  return map
}
const feature = (title, extra) => Object.assign({ declaredClass: 'esri.layers.FeatureLayer', type: 'feature', title, visible: true, url: `https://gis/${title}/FeatureServer/0`, queryFeatures () {} }, extra || {})
const group = (title, layers, extra) => Object.assign({ declaredClass: 'esri.layers.GroupLayer', type: 'group', title, visible: true, layers }, extra || {})
const service = (id, sublayers, extra) => Object.assign({ declaredClass: 'esri.layers.MapImageLayer', type: 'map-image', id, title: id, visible: true, url: `https://gis/${id}/MapServer`, sublayers }, extra || {})
const sub = (id, title, extra) => Object.assign({ declaredClass: 'esri.layers.support.Sublayer', id, title, visible: true, queryFeatures () {} }, extra || {})
const names = (entries) => entries.map((e) => e.name)

test('only layers that are switched on are searched', () => {
  const map = webmap([feature('Parcels'), feature('Zoning', { visible: false })])
  assert.deepEqual(names(lw.collectQueryableLayers(map)), ['Parcels'])
})

test('a group that is off takes its layers with it; a layer that is off inside an on group stays out', () => {
  const map = webmap([
    group('Utilities', [feature('Water'), feature('Sewer', { visible: false })]),
    group('Hidden', [feature('Storm')], { visible: false })
  ])
  assert.deepEqual(names(lw.collectQueryableLayers(map)), ['Water'])
})

test('a group with visibilityMode "inherited" decides for its children', () => {
  const map = webmap([group('Inherited', [feature('A', { visible: false }), feature('B')], { visibilityMode: 'inherited' })])
  assert.deepEqual(names(lw.collectQueryableLayers(map)).sort(), ['A', 'B'])
})

test('groups nest to any depth, and the order is the layer list order (topmost first)', () => {
  const map = webmap([
    feature('Bottom'),
    group('G1', [group('G2', [group('G3', [feature('Deep')])]), feature('Mid')]),
    feature('Top')
  ])
  const entries = lw.collectQueryableLayers(map)
  assert.deepEqual(names(entries), ['Top', 'Mid', 'Deep', 'Bottom'])
  assert.equal(entries.find((e) => e.name === 'Deep').titlePath, 'G1 / G2 / G3 / Deep')
})

test('map service sublayers: leaves only, off sublayers and off group sublayers skipped, URL built from the service', () => {
  const map = webmap([service('Base', [
    sub(0, 'Roads'),
    sub(1, 'Off', { visible: false }),
    sub(2, 'Group', { sublayers: [sub(3, 'Inside'), sub(4, 'Inside off', { visible: false })] }),
    sub(5, 'Group off', { visible: false, sublayers: [sub(6, 'Under off group')] })
  ])])
  const entries = lw.collectQueryableLayers(map)
  assert.deepEqual(names(entries).sort(), ['Inside', 'Roads'])
  assert.equal(entries.find((e) => e.name === 'Roads').layerUrl, 'https://gis/Base/MapServer/0')
})

test('a map service that is off is skipped entirely', () => {
  const map = webmap([service('Base', [sub(0, 'Roads')], { visible: false })])
  assert.deepEqual(lw.collectQueryableLayers(map), [])
})

test('scale: the layer, its group and its sublayer scale ranges are all honored', () => {
  const map = webmap([
    feature('Zoomed in only', { maxScale: 0, minScale: 5000 }),
    group('Far group', [feature('Inside far group')], { minScale: 10000 }),
    service('Svc', [sub(0, 'Close sub', { minScale: 2000 }), sub(1, 'Any sub')])
  ])
  assert.deepEqual(names(lw.collectQueryableLayers(map, { scale: 20000 })), ['Any sub'])
  assert.deepEqual(names(lw.collectQueryableLayers(map, { scale: 1000 })).sort(), ['Any sub', 'Close sub', 'Inside far group', 'Zoomed in only'])
  assert.equal(lw.collectQueryableLayers(map, { scale: 0 }).length, 4, 'scale 0 means unknown: no scale filtering')
})

test('the layer view has the last word on what draws', () => {
  const a = feature('Out of range per view')
  const b = feature('Time filtered')
  const c = feature('Drawn')
  const map = webmap([a, b, c])
  const views = new Map([[a, { visibleAtCurrentScale: false }], [b, { visibleAtCurrentTimeExtent: false }], [c, { visibleAtCurrentScale: true }]])
  assert.deepEqual(names(lw.collectQueryableLayers(map, { layerViewFor: (l) => views.get(l) })), ['Drawn'])
})

test('helper layers hidden from the layer list, and layers that cannot be queried, are skipped', () => {
  const map = webmap([
    feature('Helper', { listMode: 'hide' }),
    { declaredClass: 'esri.layers.GraphicsLayer', type: 'graphics', title: 'Sketch', visible: true },
    { declaredClass: 'esri.layers.VectorTileLayer', type: 'vector-tile', title: 'Basemap-ish', visible: true },
    feature('Real')
  ])
  assert.deepEqual(names(lw.collectQueryableLayers(map)), ['Real'])
})

test('subtype group layer: only the subtypes switched on are searched', () => {
  const sgl = (codes) => ({
    declaredClass: 'esri.layers.SubtypeGroupLayer', type: 'subtype-group', title: 'Assets', visible: true,
    url: 'https://gis/Assets/FeatureServer/0', subtypeField: 'ASSETTYPE', queryFeatures () {},
    sublayers: codes.map(([code, visible]) => ({ subtypeCode: code, visible }))
  })
  const some = lw.collectQueryableLayers(webmap([sgl([[1, true], [2, false], [3, true]])]))
  assert.equal(some[0].extraWhere, 'ASSETTYPE IN (1, 3)')
  assert.equal(lw.collectQueryableLayers(webmap([sgl([[1, true], [2, true]])]))[0].extraWhere, undefined)
  assert.deepEqual(lw.collectQueryableLayers(webmap([sgl([[1, false], [2, false]])])), [])
  assert.equal(lw.subtypeWhere({ subtypeField: 'T', sublayers: [{ subtypeCode: "O'Brien", visible: true }, { subtypeCode: 'X', visible: false }] }), "T IN ('O''Brien')")
})

test('a layer that appears twice is searched once', () => {
  const shared = feature('Parcels')
  const map = webmap([shared, group('G', [feature('Parcels')])])
  assert.equal(lw.collectQueryableLayers(map).length, 1)
})

test('the layer-set signature changes when a layer is switched on or off, and only then', () => {
  const water = feature('Water')
  const map = webmap([water, feature('Sewer')])
  const sig = () => lw.layerSetSignature(lw.collectQueryableLayers(map))
  const before = sig()
  assert.equal(sig(), before)
  water.visible = false
  const off = sig()
  assert.notEqual(off, before)
  water.visible = true
  assert.equal(sig(), before)
  map.layers.push(feature('Added at runtime'))
  map.layers[2].parent = map
  assert.notEqual(sig(), before)
})

test('Collections work as well as arrays, and reading them touches length (so watchers see adds)', () => {
  let touched = 0
  const col = { get length () { touched++; return 1 }, toArray () { return [feature('X')] } }
  assert.equal(lw.itemsOf(col).length, 1)
  assert.equal(touched, 1)
  assert.deepEqual(lw.itemsOf(null), [])
  assert.deepEqual(lw.itemsOf({ items: [1, 2] }), [1, 2])
})

test('selection: all and missing mean every layer', () => {
  const map = webmap([feature('A', { id: 'a' })])
  const a = map.layers[0]
  assert.equal(lw.selectionAllows(a, undefined), true)
  assert.equal(lw.selectionAllows(a, { mode: 'all' }), true)
})

test('selection, excluded: an unticked layer stays out; an unticked group keeps out its layers, including ones added later', () => {
  const g = group('Utilities', [feature('Water', { id: 'water' })], { id: 'util' })
  const other = feature('Parcels', { id: 'parcels' })
  const map = webmap([g, other])
  const sel = { mode: 'excluded', excludedKeys: ['util'] }
  assert.equal(lw.selectionAllows(g.layers[0], sel), false)
  const later = feature('Added later', { id: 'later' })
  g.layers.push(later); later.parent = g
  assert.equal(lw.selectionAllows(later, sel), false)
  assert.equal(lw.selectionAllows(other, sel), true)
  // a brand new top-level layer the author never saw is searched
  const fresh = feature('From Add data', { id: 'fresh' }); fresh.parent = map
  assert.equal(lw.selectionAllows(fresh, sel), true)
})

test('selection, excluded: a map service sublayer key', () => {
  const svc = service('svc1', [sub(3, 'Hydrants'), sub(4, 'Valves')])
  webmap([svc])
  const sel = { mode: 'excluded', excludedKeys: ['svc1::sub::3'] }
  assert.equal(lw.selectionAllows(svc.sublayers[0], sel), false)
  assert.equal(lw.selectionAllows(svc.sublayers[1], sel), true)
})

test('selection, legacy include list: listed, trusted, and new sublayers of a listed service', () => {
  const svc = service('svc1', [sub(3, 'Hydrants'), sub(4, 'Valves')])
  const g = group('Trusted', [feature('T1', { id: 't1' })], { id: 'tg' })
  const lone = feature('Lone', { id: 'lone' })
  webmap([svc, g, lone])
  const sel = { mode: 'selected', selectedKeys: ['svc1::sub::3'], trustedGroupKeys: ['tg'] }
  assert.equal(lw.selectionAllows(svc.sublayers[0], sel), true)
  assert.equal(lw.selectionAllows(svc.sublayers[1], sel), true, 'same service: picked up')
  assert.equal(lw.selectionAllows(g.layers[0], sel), true, 'trusted group')
  assert.equal(lw.selectionAllows(lone, sel), false)
})

test('collectQueryableLayers applies the include filter', () => {
  const map = webmap([feature('A', { id: 'a' }), feature('B', { id: 'b' })])
  const sel = { mode: 'excluded', excludedKeys: ['b'] }
  assert.deepEqual(names(lw.collectQueryableLayers(map, { include: (l) => lw.selectionAllows(l, sel) })), ['A'])
})

test('isSwitchedOn and isInScale look all the way up', () => {
  const leaf = feature('Leaf')
  const map = webmap([group('Outer', [group('Inner', [leaf], { minScale: 5000 })])])
  assert.equal(lw.isSwitchedOn(leaf), true)
  map.layers[0].visible = false
  assert.equal(lw.isSwitchedOn(leaf), false)
  assert.equal(lw.isInScale(leaf, 10000), false)
  assert.equal(lw.isInScale(leaf, 1000), true)
})

test('basemap layers do not count as operational', () => {
  const basemapRef = feature('Reference')
  const basemap = { declaredClass: 'esri.Basemap', parent: null }
  basemapRef.parent = basemap
  assert.equal(lw.isNonOperational(basemapRef), true)
  const op = feature('Op'); webmap([op])
  assert.equal(lw.isNonOperational(op), false)
})

test('point query: keeps the layer definition, adds the app filter and subtype filter, and the right tolerance', () => {
  const layer = { createQuery () { return { where: "STATUS = 'Active'", gdbVersion: 'SDE.DEFAULT' } } }
  const q = lw.buildPointQuery(layer, {
    point: { x: 1, y: 2 },
    distanceMeters: 15,
    maxResults: 7,
    orderBy: 'NAME',
    layerView: { filter: { where: 'ZONE = 3' } },
    extraWhere: 'ASSETTYPE IN (1, 3)'
  })
  assert.equal(q.where, "(STATUS = 'Active') AND (ZONE = 3) AND (ASSETTYPE IN (1, 3))")
  assert.equal(q.gdbVersion, 'SDE.DEFAULT')
  assert.deepEqual(q.geometry, { x: 1, y: 2 })
  assert.equal(q.spatialRelationship, 'intersects')
  assert.deepEqual(q.outFields, ['*'])
  assert.equal(q.returnGeometry, true)
  assert.equal(q.num, 7)
  assert.equal(q.distance, 15)
  assert.equal(q.units, 'meters')
  assert.deepEqual(q.orderByFields, ['NAME'])
})

test('point query: polygons get no distance; layers without createQuery still work', () => {
  const q = lw.buildPointQuery({}, { point: {}, distanceMeters: 0 })
  assert.equal(q.where, '1=1')
  assert.equal(q.distance, undefined)
  const broken = lw.buildPointQuery({ createQuery () { throw new Error('nope') } }, { point: {} })
  assert.equal(broken.where, '1=1')
})

test('point query: the time slider applies only to time-aware layers that follow view time', () => {
  const t = { start: 1, end: 2 }
  assert.equal(lw.buildPointQuery({ timeInfo: {} }, { point: {}, viewTimeExtent: t }).timeExtent, t)
  assert.equal(lw.buildPointQuery({ timeInfo: {}, useViewTime: false }, { point: {}, viewTimeExtent: t }).timeExtent, undefined)
  assert.equal(lw.buildPointQuery({}, { point: {}, viewTimeExtent: t }).timeExtent, undefined)
  const own = { start: 5 }
  assert.equal(lw.buildPointQuery({ timeInfo: {}, createQuery: () => ({ timeExtent: own }) }, { point: {}, viewTimeExtent: t }).timeExtent, own)
})

test('andWhere skips empty parts and 1=1', () => {
  assert.equal(lw.andWhere('', null, '1=1'), '1=1')
  assert.equal(lw.andWhere('A = 1'), 'A = 1')
  assert.equal(lw.andWhere('1=1', 'A = 1', 'B = 2'), '(A = 1) AND (B = 2)')
})
