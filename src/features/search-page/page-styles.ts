/**
 * Light-DOM rules toggled by attributes on <html>. Injected at document_start
 * so a blacklisted search never flashes the unfiltered native list.
 */
export const PAGE_CSS = `
html[data-wmp-filtered] main[class*="search-result_Container__"],
html[data-wmp-filtered] [class*="search_Pagination__"],
html[data-wmp-filtered] [class*="search-sort-selector_Container__"] > p {
  display: none !important;
}

@media (min-width: 1072px) {
  html[data-wmp-panel="open"] [class*="layout-main-content_Search__"] {
    grid-template-columns: minmax(0, 1fr) var(--wmp-panel-width, 320px) !important;
  }
  html[data-wmp-panel="open"] aside[class*="layout-main-content_Aside__"] {
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
  }
}

/* The page grows into its side margins while the panel is open (see layout.ts). */
html[data-wmp-wide] [class*="header-breadcrumb_Container__"] > .container,
html[data-wmp-wide] [class*="header-title_Container__"] > .container,
html[data-wmp-wide] [class*="layout-main-content_Container__"],
html[data-wmp-wide] [class*="search-internal-links_Wrapper__"] {
  width: var(--wmp-page-width) !important;
  max-width: calc(100vw - 48px) !important;
}
`;
