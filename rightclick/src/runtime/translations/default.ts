export default {
  _widgetLabel: 'Right Click',

  // Help guide (shared keys, same wording in every GIS Division widget)
  helpTitle: 'Help',
  close: 'Close',
  helpIntro: 'Right click anywhere on the map to get a menu of things you can do at that spot.',
  helpSearchPlaceholder: 'Search the guide (try "copy" or "measure")',
  helpNoMatches: 'Nothing in the guide matches that word. Try another, or open the sections above.',
  helpAnd: 'and',

  // Start here
  helpStartTitle: 'Start here: three steps',
  helpStart1: 'Right click on the map where you are interested. On a phone or tablet, press and hold instead.',
  helpStart2: 'Read the top of the menu. It shows the coordinates of that spot{address}.',
  helpStart3: 'Click one of the actions in the list. The menu closes and the action runs.',

  // The menu, button by button
  helpMenuTitle: 'The menu, button by button',
  helpMenuIntro: 'Only the actions turned on for this app appear. Yours may show fewer than these.',
  helpMenuZoomIn: 'Zoom In: zooms the map in, centered on the spot you clicked.',
  helpMenuZoomOut: 'Zoom Out: zooms the map out, centered on the spot you clicked.',
  helpMenuCenter: 'Center Here: moves the map so the spot you clicked is in the middle.',
  helpMenuCopy: 'Copy Coordinates: copies the coordinates shown under it to your clipboard.',
  helpMenuFormats: 'More coordinate formats: opens a list of other ways to write the same spot. Click one to copy it.',
  helpMenuAddress: 'Copy Address: copies the street address shown at the top of the menu.',
  helpMenuPlotMarker: 'Plot Marker: drops a small dot on the map at that spot.',
  helpMenuPlotCoordinates: 'Plot Coordinate: drops a numbered marker with its coordinates written next to it.',
  helpMenuAddText: 'Add Text: asks you for a short note and writes it on the map at that spot.',
  helpMenuUndo: 'Undo Last Graphic: removes the last marker or note you added.',
  helpMenuClear: 'Clear All Graphics: removes every marker and note you added. The number in brackets is how many there are.',
  helpMenuStreetView: 'Open in Google Street View: opens a new browser tab looking at that spot from the street.',
  helpMenuGoogleMaps: 'Open in Google Maps: opens a new browser tab with that spot on Google Maps.',
  helpMenuPictometry: 'Open in Pictometry: opens a new browser tab with aerial photos of that spot.',
  helpMenuMeasureDistance: 'Measure Distance: starts a ruler at that spot. Click along the map to add points, double click to finish.',
  helpMenuMeasureArea: 'Measure Area: starts an area tool at that spot. Click around the shape, double click to finish.',
  helpMenuWhatsHere: 'What\'s here?: lists the map features found at that spot, grouped by layer.',
  helpMenuPropertyReport: '{label}: opens the property tool for the parcel at that spot.',
  helpMenuMailingLabels: '{label}: opens the mailing labels tool for that spot, with an optional distance around it.',

  // Coordinates and address
  helpCoordsTitle: 'Coordinates and the address',
  helpCoords1: 'The small numbers at the top of the menu are the coordinates of the spot you clicked, in the system chosen for this app.',
  helpCoords2: 'Copy Coordinates copies exactly what is shown there.',
  helpCoords3: 'More coordinate formats gives you latitude and longitude in decimal and in degrees, minutes, seconds, plus a few technical formats.',
  helpCoords4: 'The address at the top is looked up for you; it says "Looking up address..." for a moment first. Click the address to copy it.',

  // Marking the map
  helpDrawTitle: 'Marking the map',
  helpDraw1: 'Markers and notes stay on the map until you remove them or reload the page. They are not saved anywhere.',
  helpDraw2: 'To remove them, right click anywhere and use Undo Last Graphic or Clear All Graphics.',
  helpDraw3: 'Add Text opens a small box. Type your note and press Enter, or Cancel to close it without adding anything.',

  // Measuring
  helpMeasureTitle: 'Measuring',
  helpMeasure1: 'After you pick Measure Distance or Measure Area, the first point is already placed where you right clicked.',
  helpMeasure2: 'Click to add more points and double click to finish. The result appears in a small panel on the map.',
  helpMeasure3: 'Units start at {units}. Use the dropdown in the panel to change them.',
  helpMeasure4: 'Close the panel with its Close button when you are done.',

  // Finding out what is here
  helpInfoTitle: 'Finding out what is here',
  helpInfo1: 'What\'s here? searches the map layers around the spot you clicked and lists what it finds, one row per feature.',
  helpInfo2: 'Click a row to see its details. Use Back to return to the list and Zoom to to go to that feature.',
  helpInfo3: 'The tools it opens ({tools}) start with the spot you clicked already filled in.',

  // Keyboard and touch
  helpKeysTitle: 'Keyboard and touch',
  helpKeys1: 'Press the number shown at the right of a row to run it without the mouse.',
  helpKeys2: 'Use the up and down arrows to move through the menu, Enter to run the highlighted row, and Escape to close the menu.',
  helpKeys3: 'On a touch screen, press and hold on the map for about half a second to open the menu.',

  // If something looks wrong
  helpTroubleTitle: 'If something looks wrong',
  helpTroubleNoMenu: 'Nothing happens on right click: the click landed outside the map, or the browser menu took over. Right click again on the map itself.',
  helpTroubleAddress: 'The address never appears: the address service did not answer. The coordinates still work; try again in a moment.',
  helpTroubleCopy: 'Copy did nothing: the browser blocked the clipboard. A small box with the text appears instead; select it and copy.',
  helpTroubleExternal: 'A Google or Pictometry link did not open: the browser blocked a pop-up. Allow pop-ups for this site and try again.',
  helpTroubleContact: 'Still stuck? Contact the GIS Division and mention the Right Click name and this app.',

  // Good to know
  helpTipsTitle: 'Good to know',
  helpTips1: 'You can right click on top of your own markers and notes; the menu works there too.',
  helpTips2: 'The menu always stays fully on the screen. Near an edge it opens toward the middle of the map instead.',
  helpTips3: 'The Help button on the menu opens this guide any time.'
}
