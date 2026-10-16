import { defineWebExtConfig } from 'wxt';

// Webmotors is protected by PerimeterX, which blocks browsers launched with
// automation flags. Load `.output/chrome-mv3(-dev)` unpacked in your own
// Chrome profile instead of letting WXT open a browser.
export default defineWebExtConfig({
  disabled: true,
});
