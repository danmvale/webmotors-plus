import { describe, expect, it, vi } from 'vitest';
import { SearchSession } from '../src/features/search/session';
import { pathKey, TreeController } from '../src/features/tree/controller';
import type { WebmotorsClient } from '../src/lib/webmotors/client';
import { parseSearchUrl, type SearchState } from '../src/lib/webmotors/search-url';
import type { SearchResponse } from '../src/lib/webmotors/types';
import { makeFacetResponse, rawListing } from './fixtures/search';

/** Honda in São Paulo: HR-V (4,121 listings) loads per year, FIT (1,402) is crawled. */
function hondaClient() {
  const search = vi.fn(async (state: SearchState, opts: { showMenu: boolean }): Promise<SearchResponse> => {
    const model = state.groups[0]?.model;
    const year = Number(state.params.get('anode')) || undefined;
    if (opts.showMenu) {
      const root = makeFacetResponse({ selectHonda: true, count: 10_112 });
      if (model !== 'HR-V') return root;
      return {
        ...root,
        Count: 4121,
        Filters: [
          ...(root.Filters ?? []),
          { name: 'YearModel', items: [{ name: '2023', count: 2000 }, { name: '2024', count: 2121 }] },
        ],
      };
    }
    if (model === 'HR-V' && year) {
      const results = [
        rawListing({ model: 'HR-V', version: '1.5 EXL TURBO CVT', year, price: 150_000 }),
        rawListing({ model: 'HR-V', version: '1.5 EXL TURBO CVT', year, price: 160_000 }),
        rawListing({ model: 'HR-V', version: '1.5 EX CVT', year, price: 130_000 }),
      ];
      return { Count: results.length, SearchResults: results };
    }
    if (model === 'FIT') {
      const results = [rawListing({ model: 'FIT', version: '1.5 EX CVT', year: 2019 })];
      return { Count: results.length, SearchResults: results };
    }
    throw new Error(`unexpected request for ${model}`);
  });
  return { search } as unknown as WebmotorsClient & { search: typeof search };
}

const state = parseSearchUrl('/carros/sp?estadocidade=S%C3%A3o%20Paulo&marca1=HONDA');
const listingRequests = (client: ReturnType<typeof hondaClient>) => client.search.mock.calls.filter(([, o]) => !o.showMenu).length;

describe('TreeController (lazy mode)', () => {
  it('loads a large model per year, and only the years the user opens', async () => {
    const client = hondaClient();
    const tree = new TreeController();
    tree.load(new SearchSession(state, client), state);
    await vi.waitFor(() => expect(tree.state.get().status).toBe('ready'));
    expect(tree.state.get().mode).toBe('lazy');

    tree.toggle(pathKey('HONDA'), { kind: 'make', make: 'HONDA' });
    await vi.waitFor(() => expect(tree.state.get().makes[0]?.models).toBeDefined());

    tree.toggle(pathKey('HONDA', 'HR-V'), { kind: 'model', make: 'HONDA', model: 'HR-V' });
    const hrv = () => tree.state.get().makes[0]!.models!.find((m) => m.name === 'HR-V')!;
    await vi.waitFor(() => expect(hrv().status).toBe('ready'));
    expect(hrv().lazyYears).toBe(true);
    expect(hrv().years!.map((y) => [y.year, y.count])).toEqual([[2024, 2121], [2023, 2000]]);
    expect(listingRequests(client)).toBe(0);

    const y2024 = hrv().years![0]!;
    tree.toggle(pathKey('HONDA', 'HR-V', 2024), { kind: 'year', make: 'HONDA', model: 'HR-V', year: y2024 });
    await vi.waitFor(() => expect(hrv().years![0]!.status).toBe('ready'));
    const versions = hrv().years![0]!.versions;
    expect(versions.map((v) => [v.name, v.count, v.avgPrice])).toEqual([
      ['1.5 EXL TURBO CVT', 2, 155_000],
      ['1.5 EX CVT', 1, 130_000],
    ]);
    expect(listingRequests(client)).toBe(1);
  });

  it('crawls a small model as soon as it is expanded', async () => {
    const client = hondaClient();
    const tree = new TreeController();
    tree.load(new SearchSession(state, client), state);
    await vi.waitFor(() => expect(tree.state.get().status).toBe('ready'));
    tree.toggle(pathKey('HONDA'), { kind: 'make', make: 'HONDA' });
    await vi.waitFor(() => expect(tree.state.get().makes[0]?.models).toBeDefined());
    tree.toggle(pathKey('HONDA', 'FIT'), { kind: 'model', make: 'HONDA', model: 'FIT' });
    const fit = () => tree.state.get().makes[0]!.models!.find((m) => m.name === 'FIT')!;
    await vi.waitFor(() => expect(fit().status).toBe('ready'));
    expect(fit().lazyYears).toBeUndefined();
    expect(fit().years!.map((y) => y.year)).toEqual([2019]);
  });
});

describe('TreeController (narrowing)', () => {
  it("keeps the user's place when a click narrows the search", async () => {
    const client = hondaClient();
    const tree = new TreeController();
    tree.load(new SearchSession(state, client), state);
    await vi.waitFor(() => expect(tree.state.get().status).toBe('ready'));
    tree.toggle(pathKey('HONDA'), { kind: 'make', make: 'HONDA' });

    const fit = parseSearchUrl('/carros/sp?estadocidade=S%C3%A3o%20Paulo&marca1=HONDA&modelo1=FIT');
    tree.load(new SearchSession(fit, client), fit);
    expect(tree.isExpanded(pathKey('HONDA'))).toBe(true);

    const other = parseSearchUrl('/carros/sp?estadocidade=S%C3%A3o%20Paulo&marca1=FIAT');
    tree.load(new SearchSession(other, client), other);
    expect(tree.isExpanded(pathKey('HONDA'))).toBe(false);
  });
});

describe('TreeController (brand order)', () => {
  it('lists facet brands A–Z in lazy mode', async () => {
    const all = parseSearchUrl('/carros/sp?estadocidade=S%C3%A3o%20Paulo');
    const client = hondaClient();
    const tree = new TreeController();
    tree.load(new SearchSession(all, client), all);
    await vi.waitFor(() => expect(tree.state.get().status).toBe('ready'));
    expect(tree.state.get().makes.map((m) => m.name)).toEqual(['CHEVROLET', 'FIAT', 'HONDA', 'VOLKSWAGEN']);
  });
});
