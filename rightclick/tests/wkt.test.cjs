'use strict'
// Imported coordinate systems: the text-only WKT check in src/config.ts.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTs } = require('./helpers/load.cjs')

const { parseWktInfo, normalizeWkt } = loadTs('config.ts')
const MCLCS = fs.readFileSync(path.join(__dirname, 'fixtures', 'mclcs.prj'), 'utf8')

test('reads a real .prj file (Mesa County Local Coordinate System)', () => {
  const info = parseWktInfo(MCLCS)
  assert.equal(info.valid, true)
  assert.equal(info.name, 'MCLCSGVA')
  assert.equal(info.unit, 'Foot')
  assert.equal(info.projected, true)
  assert.equal(info.wkt2, false)
})

test('a byte-order mark and trailing line breaks do not matter', () => {
  const info = parseWktInfo('﻿' + MCLCS + '\r\n\r\n')
  assert.equal(info.valid, true)
  assert.equal(info.name, 'MCLCSGVA')
})

test('normalizeWkt strips the mark and collapses line breaks', () => {
  assert.equal(normalizeWkt('﻿GEOGCS["a",\r\n\tUNIT["Degree",1]]\n'), 'GEOGCS["a", UNIT["Degree",1]]')
  assert.equal(normalizeWkt(null), '')
  assert.equal(normalizeWkt(undefined), '')
})

test('geographic systems are recognized and report their angular unit', () => {
  const info = parseWktInfo('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]')
  assert.equal(info.valid, true)
  assert.equal(info.projected, false)
  assert.equal(info.unit, 'Degree')
})

test('WKT 2 keywords are flagged so the runtime uses the wkt2 property', () => {
  const info = parseWktInfo('PROJCRS["Local grid",BASEGEOGCRS["WGS 84",DATUM["World Geodetic System 1984",ELLIPSOID["WGS 84",6378137,298.257223563]]],CONVERSION["x",METHOD["Transverse Mercator"]],CS[Cartesian,2],LENGTHUNIT["metre",1]]')
  assert.equal(info.valid, true)
  assert.equal(info.wkt2, true)
  assert.equal(info.projected, true)
  assert.equal(info.unit, 'metre')
})

test('rejects empty text, text that is not WKT, and truncated WKT, each with its reason', () => {
  assert.deepEqual([parseWktInfo('').valid, parseWktInfo('').reason], [false, 'empty'])
  assert.deepEqual([parseWktInfo('   \n').valid, parseWktInfo('   \n').reason], [false, 'empty'])
  assert.deepEqual([parseWktInfo('<xml/>').valid, parseWktInfo('<xml/>').reason], [false, 'notWkt'])
  assert.deepEqual([parseWktInfo('EPSG:2232').valid, parseWktInfo('EPSG:2232').reason], [false, 'notWkt'])
  const cut = MCLCS.trim().slice(0, -1)
  assert.deepEqual([parseWktInfo(cut).valid, parseWktInfo(cut).reason], [false, 'unbalanced'])
  assert.equal(parseWktInfo('PROJCS["a"]]').reason, 'unbalanced')
})

test('brackets inside a quoted name do not break the balance check', () => {
  assert.equal(parseWktInfo('GEOGCS["Odd ] name [",UNIT["Degree",1]]').valid, true)
})
