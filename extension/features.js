// Feature switches for the extension. Change a value, then reload the extension on chrome://extensions.
// Read by the background worker (imported) and by content scripts (listed before them in manifest.json).
globalThis.ARM_FEATURES = Object.freeze({
  // The manager's own ways in, outside Aprimo's Administration menu:
  //   - the floating "⚙︎ Rules" button (and its overlay) on DAM pages, and
  //   - the toolbar icon opening the manager as a standalone tab.
  // false: only Administration → Content Administration → "Rules Manager - Experimental" is used, and the
  //        toolbar icon opens that Administration page instead.
  // true:  bring the standalone views back (all their code is still in place).
  standaloneViews: false,
});
