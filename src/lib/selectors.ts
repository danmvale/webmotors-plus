/**
 * Every Webmotors DOM hook the extension relies on. Class names are hashed CSS
 * Modules (`file_Class__hash`), so we match on the stable prefix or on
 * data-qa / data-testid attributes. Verified on 2026-10-15.
 */
export const SEL = {
  // Shared header (home, results and ad pages).
  headerDesktopLogo: 'a[data-qa^="header_logo_"][data-qa$="_desktop"]',
  headerMobileMenuToggle: 'button[data-qa^="headerMenu_toggle_"]',
  headerNativeAiSlot: '[class*="header_AISearchContainer__"]',

  // Homepage hero AI search.
  homeAiSearch: '[data-testid="ai-search-container"]',
  homeAiSearchMobile: '[data-testid="search_input_home_mobile"]',

  // Results page layout.
  layoutContainer: '[class*="layout-main-content_Container__"]',
  layoutSearch: '[class*="layout-main-content_Search__"]',
  layoutAside: 'aside[class*="layout-main-content_Aside__"]',
  resultsMain: 'main[class*="search-result_Container__"]',
  resultsPagination: '[class*="search_Pagination__"]',
  sortContainer: '[class*="search-sort-selector_Container__"]',
  resultCard: '[class*="vehicle-card-desktop_Container__"]',

  // Left filters sidebar.
  filtersMakeSection: '[class*="app-filters-make-selector_Anchor__"]',
  filtersCleanAll: '[data-qa="clean_all_filters_desktop"]',
} as const;
