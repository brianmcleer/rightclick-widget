'use strict'
// Pure helpers in src/config.ts that the menu and the settings panel share.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('./helpers/load.cjs')

const cfg = loadTs('config.ts')

test('customActionMatchesLayer: no match strings means every layer matches', () => {
  assert.equal(cfg.customActionMatchesLayer({}, 'Parcels', 'https://x/MapServer/3'), true)
  assert.equal(cfg.customActionMatchesLayer({ matchTitle: '  ', matchUrl: '' }, '', ''), true)
})

test('customActionMatchesLayer: title and URL are case-insensitive substrings, and both must match', () => {
  const a = { matchTitle: 'parcel', matchUrl: 'MapServer/3' }
  assert.equal(cfg.customActionMatchesLayer(a, 'Tax PARCELS', 'https://x/arcgis/rest/services/A/mapserver/3'), true)
  assert.equal(cfg.customActionMatchesLayer(a, 'Zoning', 'https://x/arcgis/rest/services/A/MapServer/3'), false)
  assert.equal(cfg.customActionMatchesLayer(a, 'Parcels', 'https://x/arcgis/rest/services/A/MapServer/4'), false)
  assert.equal(cfg.customActionMatchesLayer({ matchTitle: 'parcel' }, undefined, undefined), false)
})

test('computeLayerSelectionKey: a sublayer is keyed by its owning map service', () => {
  const service = { id: 'svc1', type: 'map-image' }
  assert.equal(cfg.computeLayerSelectionKey({ id: 7, parent: service }), 'svc1::sub::7')
  // nested sublayer: parent chain passes through another sublayer first
  const mid = { id: 2, parent: service }
  assert.equal(cfg.computeLayerSelectionKey({ id: 9, parent: mid }), 'svc1::sub::9')
})

test('computeLayerSelectionKey: a layer in a group, or at the top level, is keyed by its own id', () => {
  assert.equal(cfg.computeLayerSelectionKey({ id: 'lyrA', parent: { type: 'group', id: 'g' } }), 'lyrA')
  assert.equal(cfg.computeLayerSelectionKey({ id: 'lyrB' }), 'lyrB')
  assert.equal(cfg.computeLayerSelectionKey({ uid: 'u1' }), 'u1')
  assert.equal(cfg.computeLayerSelectionKey(null), '')
})

test('defaultCustomAction starts as an enabled link row with a generated id', () => {
  const a = cfg.defaultCustomAction()
  assert.match(a.id, /^ca-[a-z0-9]+-[a-z0-9]+$/)
  assert.equal(a.enabled, true)
  assert.equal(a.type, 'url')
  assert.equal(a.scope, 'always')
  assert.equal(a.storeKey, 'actionPoint')
})

test('feature layer validation helpers', () => {
  assert.equal(cfg.isValidFeatureServiceUrl('https://x/arcgis/rest/services/A/FeatureServer/0'), true)
  assert.equal(cfg.isValidFeatureServiceUrl('not a url'), false)
  assert.ok(Array.isArray(cfg.validateFeatureLayerConfig(cfg.defaultFeatureLayerConfig)))
})
