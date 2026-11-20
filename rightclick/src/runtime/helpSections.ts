import type { HelpSection } from './components/HelpPopup'

/** Flags the widget computes from config and live status. One per feature that has help text.
 *  Computed in widget.tsx from the same checks getMenuItems() uses, so the guide never
 *  describes a row the menu is not showing. */
export interface HelpFeatures {
  zoomIn: boolean
  zoomOut: boolean
  centerHere: boolean
  copyCoordinates: boolean
  coordinateFormats: boolean
  address: boolean
  plotMarker: boolean
  plotCoordinates: boolean
  addText: boolean
  streetView: boolean
  googleMaps: boolean
  pictometry: boolean
  measureDistance: boolean
  measureArea: boolean
  whatsHere: boolean
  propertyReport: boolean
  mailingLabels: boolean
  hotkeys: boolean
  longPress: boolean
  /** Menu label of the Property Report row, as the menu shows it. */
  propertyReportLabel: string
  /** Menu label of the Mailing Labels row, as the menu shows it. */
  mailingLabelsLabel: string
  /** Default measurement units, already in the app language (feet, meters, ...). */
  measureUnits: string
  /** Menu labels of the imported coordinate systems (from a .prj file), as the menu shows them. */
  importedSystems: string[]
  /** Labels of custom rows that show on every right click. */
  customAlways: string[]
  /** Labels of custom rows that show only when a matching map feature is under the pointer. */
  customFeature: string[]
}

type T = (id: string, values?: Record<string, string>) => string

export function buildHelpSections (t: T, f: HelpFeatures): HelpSection[] {
  const when = (on: boolean, ...ids: string[]): string[] => (on ? ids.map((id: string) => t(id)) : [])
  const listOf = (parts: string[]): string =>
    parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} ${t('helpAnd')} ${parts[parts.length - 1]}`

  const anyGraphics = f.plotMarker || f.plotCoordinates || f.addText
  const anyMeasure = f.measureDistance || f.measureArea
  const anyExternal = f.streetView || f.googleMaps || f.pictometry
  const anyInfo = f.whatsHere || f.propertyReport || f.mailingLabels
  const launchTools = listOf([
    ...(f.propertyReport ? [f.propertyReportLabel] : []),
    ...(f.mailingLabels ? [f.mailingLabelsLabel] : [])
  ])

  const menuBody: string[] = [
    ...when(f.zoomIn, 'helpMenuZoomIn'),
    ...when(f.zoomOut, 'helpMenuZoomOut'),
    ...when(f.centerHere, 'helpMenuCenter'),
    ...when(f.copyCoordinates, 'helpMenuCopy'),
    ...(f.copyCoordinates && f.importedSystems.length ? [t('helpMenuImported', { labels: listOf(f.importedSystems) })] : []),
    ...when(f.copyCoordinates && f.coordinateFormats, 'helpMenuFormats'),
    ...when(f.address, 'helpMenuAddress'),
    ...when(f.plotMarker, 'helpMenuPlotMarker'),
    ...when(f.plotCoordinates, 'helpMenuPlotCoordinates'),
    ...when(f.addText, 'helpMenuAddText'),
    ...when(anyGraphics, 'helpMenuUndo', 'helpMenuClear'),
    ...when(f.streetView, 'helpMenuStreetView'),
    ...when(f.googleMaps, 'helpMenuGoogleMaps'),
    ...when(f.pictometry, 'helpMenuPictometry'),
    ...when(f.measureDistance, 'helpMenuMeasureDistance'),
    ...when(f.measureArea, 'helpMenuMeasureArea'),
    ...when(f.whatsHere, 'helpMenuWhatsHere'),
    ...(f.propertyReport ? [t('helpMenuPropertyReport', { label: f.propertyReportLabel })] : []),
    ...(f.mailingLabels ? [t('helpMenuMailingLabels', { label: f.mailingLabelsLabel })] : []),
    ...(f.customAlways.length ? [t('helpMenuCustomAlways', { labels: listOf(f.customAlways) })] : []),
    ...(f.customFeature.length ? [t('helpMenuCustomFeature', { labels: listOf(f.customFeature) })] : [])
  ]

  return [
    {
      key: 'start',
      icon: 'play',
      title: t('helpStartTitle'),
      ordered: true,
      body: [
        t(f.longPress ? 'helpStart1' : 'helpStart1NoTouch'),
        t(f.address ? 'helpStart2Address' : 'helpStart2Plain'),
        t('helpStart3')
      ]
    },
    // With every action turned off there are no rows to describe: drop the section.
    ...(menuBody.length ? [{ key: 'menu', icon: 'ellipsis', title: t('helpMenuTitle'), intro: t('helpMenuIntro'), body: menuBody }] : []),
    ...(f.copyCoordinates
      ? [{
          key: 'coords',
          icon: 'globe',
          title: t('helpCoordsTitle'),
          body: [
            t('helpCoords1'),
            t('helpCoords2'),
            ...(f.importedSystems.length ? [t('helpCoordsImported', { labels: listOf(f.importedSystems) })] : []),
            ...when(f.coordinateFormats, 'helpCoords3'),
            ...when(f.address, 'helpCoords4')
          ]
        }]
      : []),
    ...(anyGraphics
      ? [{ key: 'draw', icon: 'pin', title: t('helpDrawTitle'), body: [t('helpDraw1'), t('helpDraw2'), ...when(f.addText, 'helpDraw3')] }]
      : []),
    ...(anyMeasure
      ? [{
          key: 'measure',
          icon: 'measure',
          title: t('helpMeasureTitle'),
          body: [t('helpMeasure1'), t('helpMeasure2'), t('helpMeasure3', { units: f.measureUnits }), t('helpMeasure4')]
        }]
      : []),
    ...(anyInfo
      ? [{
          key: 'info',
          icon: 'question',
          title: t('helpInfoTitle'),
          body: [...when(f.whatsHere, 'helpInfo1', 'helpInfo2'), ...(launchTools ? [t('helpInfo3', { tools: launchTools })] : [])]
        }]
      : []),
    { key: 'keys', icon: 'keyboard', title: t('helpKeysTitle'), body: [...when(f.hotkeys, 'helpKeys1'), t('helpKeys2'), ...when(f.longPress, 'helpKeys3')] },
    {
      key: 'trouble',
      icon: 'exclamation-mark-triangle',
      title: t('helpTroubleTitle'),
      body: [
        t('helpTroubleNoMenu'),
        ...when(f.customFeature.length > 0, 'helpTroubleCustomFeature'),
        ...when(f.address, 'helpTroubleAddress'),
        ...when(f.copyCoordinates && f.importedSystems.length > 0, 'helpTroubleImported'),
        ...when(f.copyCoordinates, 'helpTroubleCopy'),
        ...when(anyExternal, 'helpTroubleExternal'),
        t('helpTroubleContact')
      ]
    },
    { key: 'tips', icon: 'lightbulb', title: t('helpTipsTitle'), body: [...when(anyGraphics, 'helpTips1'), t('helpTips2'), t('helpTips3')] }
  ]
}
