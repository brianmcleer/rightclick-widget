// vendor-shims.d.ts
// City of Grand Junction GIS Division
//
// Widget-specific editor declarations for the Right Click widget. Sits beside
// the untouched master copy of exb-editor-shims.d.ts (copied from
// widgets\_vs) so the master can stay byte-identical across widgets.
// Editor only: emits nothing. publish.ps1 keeps this file out of the release
// zip (its ambient blocks would leak into other widgets).
//
// Keep this file a script (no top-level import/export) so every block below
// stays ambient and merges with the master shim's declarations.

// ── jimu-core members the master shim does not list ─────────────────────────
declare module 'jimu-core' {
    export const MutableStoreManager: any
}

// ── ArcGIS Maps SDK modules imported with `import * as X` ───────────────────
// The master shim's 'esri/*' wildcard exposes only a default export, so a
// namespace import of it has no members. These specific declarations win
// over the wildcard and type the whole namespace as `any`.
declare module 'esri/geometry/operators/projectOperator' {
    const mod: any
    export = mod
}
declare module 'esri/geometry/support/jsonUtils' {
    const mod: any
    export = mod
}
declare module 'esri/rest/locator' {
    const mod: any
    export = mod
}
declare module 'esri/core/reactiveUtils' {
    const mod: any
    export = mod
}

// ── Calcite wrapper supplied by Experience Builder ──────────────────────────
declare module 'calcite-components' {
    export const CalciteIcon: any
    export const CalciteChip: any
}
