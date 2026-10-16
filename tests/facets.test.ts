import { describe, expect, it } from 'vitest';
import { addMake, addModel, EMPTY_BLACKLIST } from '../src/features/blacklist/blacklist';
import { brandsNeedingModelFacet, exclusionCount, findItem, makeFacet } from '../src/features/search/facets';
import { parseSearchUrl, withBlacklist } from '../src/lib/webmotors/search-url';
import { makeFacetResponse } from './fixtures/search';

const allSp = parseSearchUrl('/carros/sp?estadocidade=S%C3%A3o%20Paulo');
const hondaSp = parseSearchUrl('/carros/sp?estadocidade=S%C3%A3o%20Paulo&marca1=HONDA');
const civicSp = parseSearchUrl('/carros/sp?estadocidade=S%C3%A3o%20Paulo&marca1=HONDA&modelo1=CIVIC');

describe('exclusionCount (disjunctive facets)', () => {
  it('no brand filter: brand counts come from the root facet', () => {
    const bl = addMake(addMake(EMPTY_BLACKLIST, 'FIAT'), 'CHEVROLET');
    const root = makeFacetResponse({ count: 195072 });
    expect(exclusionCount(withBlacklist(allSp, bl), root, new Map())).toBe(20432 + 18977);
  });

  it('no brand filter: model counts come from the brand facet', () => {
    const state = withBlacklist(allSp, addModel(EMPTY_BLACKLIST, 'HONDA', 'FIT'));
    expect(brandsNeedingModelFacet(state)).toEqual(['HONDA']);
    const hondaFacet = findItem(makeFacet(makeFacetResponse({ selectHonda: true, count: 10833 })), 'HONDA')!.items!;
    const root = makeFacetResponse({ count: 195072 });
    expect(exclusionCount(state, root, new Map([['HONDA', hondaFacet]]))).toBe(1402);
  });

  it('brand filter: other brands are not in the results', () => {
    const state = withBlacklist(hondaSp, addMake(EMPTY_BLACKLIST, 'FIAT'));
    expect(exclusionCount(state, makeFacetResponse({ selectHonda: true, count: 10833 }), new Map())).toBe(0);
  });

  it('brand filter: models of the filtered brand are nested in the root', () => {
    const state = withBlacklist(hondaSp, addModel(addModel(EMPTY_BLACKLIST, 'HONDA', 'HR-V'), 'HONDA', 'FIT'));
    expect(brandsNeedingModelFacet(state)).toEqual([]);
    expect(exclusionCount(state, makeFacetResponse({ selectHonda: true, count: 10833 }), new Map())).toBe(4121 + 1402);
  });

  it('model filter: blacklisting another model of that brand hides nothing', () => {
    const state = withBlacklist(civicSp, addModel(EMPTY_BLACKLIST, 'HONDA', 'FIT'));
    expect(exclusionCount(state, makeFacetResponse({ selectHonda: true, selectCivic: true, count: 1975 }), new Map())).toBe(0);
  });

  it('a blacklisted brand that is also filtered hides what its group contributes', () => {
    const state = withBlacklist(civicSp, addMake(EMPTY_BLACKLIST, 'HONDA'));
    expect(exclusionCount(state, makeFacetResponse({ selectHonda: true, selectCivic: true, count: 1975 }), new Map())).toBe(1975);
  });
});
