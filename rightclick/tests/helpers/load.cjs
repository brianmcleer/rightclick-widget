'use strict'
// Test loader for the Right Click widget. No Jest and no dependencies of its
// own: it transpiles the widget's TypeScript with the TypeScript that already
// ships in the Experience Builder client, and evaluates the result in Node.
//
// Only modules with no Experience Builder or Maps SDK imports can be loaded
// this way (config.ts, helpSections.ts, translations). That is deliberate: the
// tests cover the pure logic and the text, not the React UI.
//
// Run from the widget folder:   node --test "tests/*.test.cjs"

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const WIDGET_ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(WIDGET_ROOT, 'src')

function findTypeScript () {
  // The widget folder has no node_modules of its own worth using; walk up to
  // the client folder (your-extensions/widgets/<widget> -> client).
  const roots = [WIDGET_ROOT, path.resolve(WIDGET_ROOT, '..', '..', '..'), process.cwd()]
  for (const root of roots) {
    try { return require(require.resolve('typescript', { paths: [root] })) } catch (e) { /* next */ }
  }
  throw new Error('TypeScript not found. Run the tests from inside an Experience Builder client (client/your-extensions/widgets/rightclick), or set NODE_PATH to a folder that contains typescript.')
}

const ts = findTypeScript()
const cache = new Map()

/** Load a .ts module (path relative to src/, or absolute) and return its exports. */
function loadTs (relOrAbs) {
  const file = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(SRC, relOrAbs)
  if (cache.has(file)) return cache.get(file).exports
  const source = fs.readFileSync(file, 'utf8')
  const out = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.React }
  }).outputText
  const mod = new Module(file)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  cache.set(file, mod)
  mod.require = (request) => {
    if (request.startsWith('.')) {
      const base = path.resolve(path.dirname(file), request)
      for (const ext of ['.ts', '.tsx', path.sep + 'index.ts']) {
        if (fs.existsSync(base + ext)) return loadTs(base + ext)
      }
      return require(base)
    }
    throw new Error(`${path.relative(WIDGET_ROOT, file)} imports "${request}", which the test loader does not provide. Only modules free of jimu-* and esri/* imports can be unit tested.`)
  }
  mod._compile(out, file)
  return mod.exports
}

/** Read a source file as text (path relative to the widget root). */
function readText (rel) {
  return fs.readFileSync(path.join(WIDGET_ROOT, rel), 'utf8')
}

/** Translator over a messages object that fills {tokens}, and fails loudly on a missing key. */
function makeT (messages) {
  return (id, values) => {
    if (!(id in messages)) throw new Error(`Missing translation key: ${id}`)
    return String(messages[id]).replace(/\{(\w+)\}/g, (m, k) => (values && values[k] != null ? String(values[k]) : m))
  }
}

module.exports = { loadTs, readText, makeT, WIDGET_ROOT, SRC }
