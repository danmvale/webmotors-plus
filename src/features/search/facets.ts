import { nameKey } from '../../lib/webmotors/slug';
import type { SearchState } from '../../lib/webmotors/search-url';
import type { FacetItem, SearchResponse } from '../../lib/webmotors/types';
import type { Blacklist } from '../blacklist/blacklist';

export function makeFacet(response: SearchResponse | undefined): FacetItem[] {
  return response?.Filters?.find((f) => f.name === 'Make')?.items ?? [];
}

export function findItem(items: FacetItem[] | null | undefined, name: string): FacetItem | undefined {
  const key = nameKey(name);
  return items?.find((i) => nameKey(i.name) === key);
}

/**
 * Brands whose nested model counts we still need to count blacklisted models.
 * Facets are disjunctive: models are only nested (with real counts) under a
 * selected brand, so a search without brand filters needs one extra facet
 * request per brand that has blacklisted models.
 */
export function brandsNeedingModelFacet(state: SearchState): string[] {
  if (state.groups.length) return [];
  return [...new Set(state.blacklist.models.map((m) => m.make))].filter((make) => !state.blacklist.makes.includes(make));
}

/**
 * How many results the blacklist hides, from facet counts alone.
 *
 * - No brand filter: brand counts in the root `Make` facet are exact; model
 *   counts come from `brandModels` (facet with that brand selected).
 * - Brand filter present: only listings of the filtered brands are in the
 *   results; models are nested under them in the root response already.
 */
export function exclusionCount(
  state: SearchState,
  root: SearchResponse,
  brandModels: Map<string, FacetItem[] | undefined>,
  blacklist: Blacklist = state.blacklist,
): number {
  const makes = makeFacet(root);
  let excluded = 0;

  if (!state.groups.length) {
    for (const make of blacklist.makes) excluded += findItem(makes, make)?.count ?? 0;
    for (const { make, model } of blacklist.models) {
      if (blacklist.makes.includes(make)) continue;
      excluded += findItem(brandModels.get(make), model)?.count ?? 0;
    }
    return excluded;
  }

  // A blacklisted brand that is also filtered (e.g. a hand-edited link) hides
  // everything its groups contribute.
  for (const make of blacklist.makes) {
    const brand = findItem(makes, make);
    for (const g of state.groups.filter((x) => nameKey(x.make) === nameKey(make))) {
      if (!g.model) excluded += brand?.count ?? 0;
      else {
        const model = findItem(brand?.items, g.model);
        excluded += (g.version ? findItem(model?.items, g.version)?.count : model?.count) ?? 0;
      }
    }
  }

  for (const { make, model } of blacklist.models) {
    if (blacklist.makes.includes(make)) continue;
    const groups = state.groups.filter((g) => nameKey(g.make) === nameKey(make));
    // Brand not in the filters, or the filter already pins other models.
    if (!groups.length || groups.every((g) => g.model)) continue;
    excluded += findItem(findItem(makes, make)?.items, model)?.count ?? 0;
  }
  return excluded;
}
