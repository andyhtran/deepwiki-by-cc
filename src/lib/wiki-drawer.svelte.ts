// Shared open/closed state for the mobile-only wiki page drawer. The toggle
// button lives in the global header (so it doesn't overlap article content),
// while the drawer markup itself lives in the wiki page route — they sync
// through this object's reactive `open` property.

export const wikiDrawer = $state({ open: false });
