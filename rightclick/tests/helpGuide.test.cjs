'use strict'
// The in-widget help guide (playbook Section 10.9): content, feature gating in
// both directions, and the writing rules of Section 10.8 as assertions.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTs, makeT } = require('./helpers/load.cjs')

const { buildHelpSections } = loadTs('runtime/helpSections.ts')
const messages = loadTs('runtime/translations/default.ts').default
const t = makeT(messages)

const BOOLEAN_FLAGS = [
  'zoomIn', 'zoomOut', 'centerHere', 'copyCoordinates', 'coordinateFormats', 'address',
  'plotMarker', 'plotCoordinates', 'addText', 'streetView', 'googleMaps', 'pictometry',
  'measureDistance', 'measureArea', 'whatsHere', 'propertyReport', 'mailingLabels', 'hotkeys', 'longPress'
]

const flags = (on, extra) => {
  const f = {
    propertyReportLabel: 'Property Information',
    mailingLabelsLabel: 'Mailing Labels',
    measureUnits: 'feet',
    importedSystems: on ? ['Mesa County LCS'] : [],
    customAlways: on ? ['Open permit search'] : [],
    customFeature: on ? ['Open asset record'] : []
  }
  BOOLEAN_FLAGS.forEach((k) => { f[k] = on })
  return Object.assign(f, extra || {})
}

const build = (f) => buildHelpSections(t, f)
const allText = (sections) => sections.map((s) => [s.title, s.intro || '', ...s.body].join('\n')).join('\n')
const section = (sections, key) => sections.find((s) => s.key === key)

test('every string resolves and no {token} is left unfilled', () => {
  for (const f of [flags(true), flags(false)]) {
    const text = allText(build(f))
    assert.doesNotMatch(text, /\{\w+\}/)
    assert.doesNotMatch(text, /undefined|null|\[object/)
  }
})

test('section order: start first, trouble then tips last, keys unique, icons distinct', () => {
  const s = build(flags(true))
  assert.deepEqual(s.map((x) => x.key), ['start', 'menu', 'coords', 'draw', 'measure', 'info', 'keys', 'trouble', 'tips'])
  assert.equal(new Set(s.map((x) => x.key)).size, s.length)
  assert.equal(new Set(s.map((x) => x.icon)).size, s.length)
  const off = build(flags(false)).map((x) => x.key)
  assert.equal(off[0], 'start')
  assert.deepEqual(off.slice(-2), ['trouble', 'tips'])
})

test('only Start here is numbered, and it has exactly three steps', () => {
  for (const f of [flags(true), flags(false)]) {
    const s = build(f)
    assert.deepEqual(s.filter((x) => x.ordered).map((x) => x.key), ['start'])
    assert.equal(section(s, 'start').body.length, 3)
  }
})

test('sections with nothing to say are dropped, not left empty', () => {
  const s = build(flags(false))
  for (const key of ['menu', 'coords', 'draw', 'measure', 'info']) assert.equal(section(s, key), undefined, key)
  for (const x of s) assert.ok(x.body.length > 0, `${x.key} has no lines`)
})

test('gating, all off: the guide does not mention any feature that is off', () => {
  const text = allText(build(flags(false)))
  const offWords = [
    'Zoom In', 'Zoom Out', 'Center Here', 'Copy Coordinates', 'More coordinate formats', 'Copy Address',
    'Plot Marker', 'Plot Coordinate', 'Add Text', 'Undo Last Graphic', 'Clear All Graphics',
    'Street View', 'Google Maps', 'Pictometry', 'Measure Distance', 'Measure Area',
    'Property Information', 'Mailing Labels', 'Mesa County LCS', 'Open permit search', 'Open asset record',
    'press and hold', 'street address', 'number shown at the right'
  ]
  for (const w of offWords) assert.ok(!text.includes(w), `"${w}" appears with every feature off`)
})

test('gating, one flag at a time: its own words appear, and only then', () => {
  const cases = [
    ['zoomIn', 'Zoom In:'], ['zoomOut', 'Zoom Out:'], ['centerHere', 'Center Here:'],
    ['copyCoordinates', 'Copy Coordinates:'], ['plotMarker', 'Plot Marker:'], ['plotCoordinates', 'Plot Coordinate:'],
    ['addText', 'Add Text:'], ['streetView', 'Open in Google Street View:'], ['googleMaps', 'Open in Google Maps:'],
    ['pictometry', 'Open in Pictometry:'], ['measureDistance', 'Measure Distance:'], ['measureArea', 'Measure Area:'],
    ['propertyReport', 'Property Information:'], ['mailingLabels', 'Mailing Labels:'],
    ['longPress', 'press and hold'], ['hotkeys', 'number shown at the right']
  ]
  const none = allText(build(flags(false)))
  for (const [flag, words] of cases) {
    assert.ok(!none.includes(words), `${flag}: "${words}" present with the flag off`)
    assert.ok(allText(build(flags(false, { [flag]: true }))).includes(words), `${flag}: "${words}" missing with the flag on`)
  }
})

test('rows that depend on two settings need both', () => {
  // "More coordinate formats" and "Copy Address" rows only exist under Copy Coordinates.
  assert.ok(!allText(build(flags(false, { coordinateFormats: true }))).includes('More coordinate formats:'))
  assert.ok(allText(build(flags(false, { coordinateFormats: true, copyCoordinates: true }))).includes('More coordinate formats:'))
  // The address line in Start here follows the address flag.
  assert.ok(allText(build(flags(false, { address: true }))).includes('street address'))
})

test('imported coordinate systems: listed by their menu labels, only when Copy Coordinates is on', () => {
  const one = build(flags(false, { copyCoordinates: true, importedSystems: ['Mesa County LCS'] }))
  assert.ok(section(one, 'menu').body.some((l) => l.startsWith('Mesa County LCS:')))
  assert.ok(section(one, 'coords').body.some((l) => l.includes('Mesa County LCS')))
  assert.ok(section(one, 'trouble').body.some((l) => l.startsWith('A coordinate system row is missing:')))
  const two = build(flags(false, { copyCoordinates: true, importedSystems: ['Grid A', 'Grid B'] }))
  assert.ok(section(two, 'menu').body.some((l) => l.startsWith('Grid A and Grid B:')))
  const copyOff = allText(build(flags(false, { importedSystems: ['Mesa County LCS'] })))
  assert.ok(!copyOff.includes('Mesa County LCS'))
})

test('lists inside sentences are built from the enabled parts: a, a and b, a, b and c', () => {
  const info = (extra) => allText(build(flags(false, extra)))
  assert.ok(info({ propertyReport: true }).includes('(Property Information)'))
  assert.ok(info({ propertyReport: true, mailingLabels: true }).includes('(Property Information and Mailing Labels)'))
  const three = build(flags(false, { customAlways: ['One', 'Two', 'Three'] }))
  assert.ok(allText(three).includes('One, Two and Three'))
})

test('search words a real user would type are in the guide', () => {
  const text = allText(build(flags(true))).toLowerCase()
  for (const w of ['copy', 'measure', 'address', 'coordinates', 'marker', 'keyboard', 'escape']) assert.ok(text.includes(w), w)
})

test('writing rules: no em or en dashes, none of the banned words', () => {
  for (const f of [flags(true), flags(false)]) {
    const text = allText(build(f))
    assert.doesNotMatch(text, /[\u2013\u2014]/)
    assert.doesNotMatch(text, /\b(instance|session|persist|sync|toggle|modal)\b/i)
  }
})

test('troubleshooting: every line is "Symptom: cause. What to do." and the contact line is last', () => {
  for (const f of [flags(true), flags(false)]) {
    const body = section(build(f), 'trouble').body
    assert.equal(body[body.length - 1], 'Still stuck? Contact the GIS Division and mention the Right Click name and this app.')
    for (const line of body.slice(0, -1)) {
      assert.match(line, /^[^:.]+: /, `no "Symptom:" lead-in: ${line}`)
      assert.ok(line.endsWith('.'), `does not end in a full stop: ${line}`)
      // a symptom, a cause, and something to do: at least two sentences after the colon
      assert.ok(line.slice(line.indexOf(':') + 1).split('. ').length >= 2, `cause only, nothing to do: ${line}`)
    }
  }
})

test('the guide names menu rows exactly as the menu spells them', () => {
  // Menu label key -> the row name used in the guide. If somebody renames a
  // row in translations and forgets the guide, this fails.
  const text = allText(build(flags(true)))
  const rows = ['zoomIn', 'zoomOut', 'centerHere', 'copyCoordinates', 'moreCoordinateFormats', 'copyAddress',
    'plotMarker', 'plotCoordinate', 'addText', 'undoLastGraphic', 'openInGoogleStreetView', 'openInGoogleMaps',
    'openInPictometry', 'measureDistance', 'measureArea']
  for (const key of rows) {
    assert.ok(key in messages, `menu label key "${key}" is gone from translations`)
    assert.ok(text.includes(messages[key]), `guide does not mention "${messages[key]}" (${key})`)
  }
  // Buttons inside the What's Here popup that the guide tells people to use.
  for (const key of ['whBack', 'whZoomTo']) assert.ok(text.includes(messages[key]), `guide does not mention "${messages[key]}"`)
})

test('shared keys carry the family wording', () => {
  assert.equal(messages.helpTitle, 'Help')
  assert.equal(messages.close, 'Close')
  assert.equal(messages.helpAnd, 'and')
  assert.equal(messages.helpNoMatches, 'Nothing in the guide matches that word. Try another, or open the sections above.')
  assert.match(messages.helpSearchPlaceholder, /^Search the guide \(try "[^"]+" or "[^"]+"\)$/)
})
