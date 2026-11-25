'use strict'
// Source hygiene: rules from the GIS Division widget playbook that are cheap
// to check mechanically and expensive to find in production.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTs, readText, WIDGET_ROOT } = require('./helpers/load.cjs')

const widget = readText('src/runtime/widget.tsx')
const setting = readText('src/setting/setting.tsx')
const config = readText('src/config.ts')
const helpSections = readText('src/runtime/helpSections.ts')
const dialogs = readText('src/runtime/components/Dialogs.tsx')
const helpPopup = readText('src/runtime/components/HelpPopup.tsx')
const runtimeMsgs = loadTs('runtime/translations/default.ts').default
const settingMsgs = loadTs('setting/translations/default.ts').default

// Strip comments so a rule about code is not tripped by prose.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const usedKeys = (src) => {
  const keys = new Set()
  const re = /(?<![\w.])(?:t|__t)\(\s*(['"])([A-Za-z_][\w]*)\1/g
  let m
  while ((m = re.exec(src)) !== null) keys.add(m[2])
  const tc = /__tc\([^,]+,\s*(['"])([A-Za-z_][\w]*)\1/g
  while ((m = tc.exec(src)) !== null) keys.add(m[2])
  return keys
}

test('every translation key the runtime uses exists in runtime/translations/default.ts', () => {
  const missing = []
  for (const src of [widget, helpSections]) for (const k of usedKeys(src)) if (!(k in runtimeMsgs)) missing.push(k)
  assert.deepEqual(missing, [])
})

test('every translation key the settings panel uses exists in setting/translations/default.ts', () => {
  const missing = []
  for (const k of usedKeys(setting)) if (!(k in settingMsgs)) missing.push(k)
  assert.deepEqual(missing, [])
})

test('no em or en dashes in any user-facing string', () => {
  for (const [name, msgs] of [['runtime', runtimeMsgs], ['setting', settingMsgs]]) {
    for (const [k, v] of Object.entries(msgs)) assert.doesNotMatch(String(v), /[\u2013\u2014]/, `${name}.${k}`)
  }
})

test('no emoji used as icons in user-facing strings', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
  for (const [k, v] of Object.entries(runtimeMsgs)) assert.doesNotMatch(String(v), emoji, `runtime.${k}`)
})

test('messages with {tokens} use plain names the fallback translator can fill', () => {
  for (const [name, msgs] of [['runtime', runtimeMsgs], ['setting', settingMsgs]]) {
    for (const [k, v] of Object.entries(msgs)) {
      for (const m of String(v).match(/\{[^}]*\}/g) || []) assert.match(m, /^\{\w+\}$/, `${name}.${k}: ${m}`)
    }
  }
})

test('nothing under src/setting, and nothing in config.ts, imports the Maps SDK', () => {
  // The settings bundle loads in the builder, which has no map; a static
  // esri import there blanks the whole settings panel (playbook 12.1).
  assert.doesNotMatch(code(setting), /from\s+['"](esri\/|@arcgis\/core)/)
  assert.doesNotMatch(code(config), /from\s+['"](esri\/|@arcgis\/core|jimu-)/)
})

test('no dynamic import() and no @ts-nocheck', () => {
  for (const [name, src] of [['widget', widget], ['setting', setting], ['config', config], ['dialogs', dialogs]]) {
    assert.doesNotMatch(code(src), /(?<![\w.])import\s*\(/, `${name}: dynamic import (playbook 12.8)`)
    assert.doesNotMatch(src, /@ts-nocheck/, `${name}: @ts-nocheck`)
  }
})

test('the only third-party imports are the ones Experience Builder supplies', () => {
  // Experience Builder supplies these (playbook Section 2 and 12.9: the map,
  // charts, coding and portal component packages are externalized by EB).
  const allowed = /^(\.|esri\/|jimu-|react($|\/)|calcite-components$|arcgis-(map|charts|coding|portal)-components$)/
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return /\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [p] : []
  })
  const bad = []
  for (const file of walk(path.join(WIDGET_ROOT, 'src'))) {
    const src = code(fs.readFileSync(file, 'utf8'))
    // Also bare side-effect imports (import 'x').
    const re = /(?:from\s+|require\(|^\s*import\s+)\s*['"]([^'"]+)['"]/gm
    let m
    while ((m = re.exec(src)) !== null) if (!allowed.test(m[1])) bad.push(`${path.relative(WIDGET_ROOT, file)}: ${m[1]}`)
  }
  assert.deepEqual(bad, [])
  const pkg = JSON.parse(readText('package.json'))
  assert.deepEqual(Object.keys(pkg.dependencies || {}), [])
})

test('React components carry no hard-coded colors', () => {
  const color = /#[0-9a-fA-F]{3,8}\b|rgba?\(/
  assert.doesNotMatch(code(dialogs), color, 'Dialogs.tsx')
  assert.doesNotMatch(code(helpPopup), color, 'HelpPopup.tsx')
})

test('widget.tsx: color literals only in the palette defaults and map graphic defaults', () => {
  // Everything the user sees as UI reads theme tokens (context menu) or
  // rcPalette (popup HTML, measurement panels). The literals that remain are
  // the palette's pre-render defaults and the default colors of graphics
  // drawn on the map, which are data, not UI chrome.
  const lines = code(widget).split('\n')
  const start = lines.findIndex((l) => l.includes('const rcPalette = {'))
  const end = lines.findIndex((l, i) => i > start && l.trim() === '};')
  const offenders = []
  lines.forEach((l, i) => {
    if (!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)) return
    if (i > start && i < end) return
    if (/(Color|color)\s*[:=]?.*(\|\||:)\s*'#[0-9a-fA-F]{6}'|hexToRgb\(/.test(l)) return
    offenders.push(`${i + 1}: ${l.trim().slice(0, 100)}`)
  })
  assert.deepEqual(offenders, [])
})

test('no bare alert() or prompt text outside the translated helpers', () => {
  const src = code(widget)
  const alerts = src.match(/(?<![\w.])alert\(/g) || []
  assert.equal(alerts.length, 1, 'alert() should only be called inside notify()')
  assert.doesNotMatch(src, /prompt\(\s*'/, 'prompt() with a hard-coded English label')
})

test('manifest and package.json carry the same version, and the newest CHANGELOG entry matches', () => {
  const manifest = JSON.parse(readText('manifest.json'))
  const pkg = JSON.parse(readText('package.json'))
  assert.equal(manifest.version, pkg.version)
  const first = /^## (\d+\.\d+\.\d+)/m.exec(readText('CHANGELOG.md'))
  assert.ok(first, 'CHANGELOG.md has no version heading')
  assert.equal(first[1], manifest.version)
})

test('help guide presentation files are present and wired', () => {
  assert.match(widget, /import HelpPopup from '\.\/components\/HelpPopup'/)
  assert.match(widget, /buildHelpSections\(/)
  assert.match(helpPopup, /export default HelpPopup/)
})
