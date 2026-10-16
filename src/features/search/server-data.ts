import type { Facet, SearchResponse } from '../../lib/webmotors/types';

export interface ServerSearch {
  /** The URL the server rendered (relative); the site may refine it right after load. */
  url: string;
  response: SearchResponse;
}

/**
 * Count and facets the results page was server-rendered with (Next.js
 * `__NEXT_DATA__`), in the same shape as the search API's `showMenu` response.
 * Only valid for `url`: the site rewrites city searches to a radius search after
 * load, and shallow navigations never update it.
 */
export function readServerSearch(doc: Document = document): ServerSearch | undefined {
  try {
    const text = doc.getElementById('__NEXT_DATA__')?.textContent;
    if (!text) return undefined;
    const props = (
      JSON.parse(text) as { props?: { pageProps?: { count?: unknown; searchFilters?: unknown; url?: unknown } } }
    ).props?.pageProps;
    if (typeof props?.count !== 'number' || !Array.isArray(props.searchFilters) || typeof props.url !== 'string') {
      return undefined;
    }
    const filters = props.searchFilters as Facet[];
    if (!filters.some((f) => f?.name === 'Make' && Array.isArray(f.items))) return undefined;
    return { url: props.url, response: { Count: props.count, Filters: filters, SearchResults: [] } };
  } catch {
    return undefined;
  }
}
