import { describe, expect, it, vi } from 'vitest';
import type { SearchCache } from '../src/features/search/search-cache';
import { readServerSearch } from '../src/features/search/server-data';
import { SearchSession } from '../src/features/search/session';
import { type CacheArea, ResponseCache } from '../src/lib/response-cache';
import type { WebmotorsClient } from '../src/lib/webmotors/client';
import { parseSearchUrl } from '../src/lib/webmotors/search-url';
import type { SearchResponse } from '../src/lib/webmotors/types';
import { makeFacetResponse, rawListing } from './fixtures/search';

function memoryArea(): CacheArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

describe('ResponseCache', () => {
  it('returns stored values until they expire', async () => {
    let now = 0;
    const cache = new ResponseCache(memoryArea(), 1000, 10_000, () => now);
    await cache.set('a', { n: 1 });
    expect(await cache.get('a')).toEqual({ n: 1 });
    now = 1001;
    expect(await cache.get('a')).toBeNull();
  });

  it('evicts the oldest entries beyond the size budget', async () => {
    let now = 0;
    const area = memoryArea();
    const cache = new ResponseCache(area, 60_000, 100, () => now);
    // Each value serializes to 25 bytes: four fit, the fifth evicts the oldest.
    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      await cache.set(key, key.repeat(23));
      now++;
    }
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBe('b'.repeat(23));
    expect(await cache.get('e')).toBe('e'.repeat(23));
    expect(area.data.has('wmResponse:a')).toBe(false);
  });

  it('reloads its index after a service-worker restart', async () => {
    const area = memoryArea();
    await new ResponseCache(area, 60_000, 10_000).set('a', [1, 2]);
    expect(await new ResponseCache(area, 60_000, 10_000).get('a')).toEqual([1, 2]);
  });

  it('skips values too large to be worth keeping', async () => {
    const cache = new ResponseCache(memoryArea(), 60_000, 100);
    await cache.set('big', 'x'.repeat(50));
    expect(await cache.get('big')).toBeNull();
  });
});

describe('SearchSession with a shared cache', () => {
  const state = parseSearchUrl('/carros/sp?estadocidade=S%C3%A3o%20Paulo&marca1=HONDA&modelo1=CIVIC');

  function fakeClient(): WebmotorsClient & { search: ReturnType<typeof vi.fn> } {
    const search = vi.fn(async (_state, opts: { perPage: number; showMenu: boolean }): Promise<SearchResponse> => {
      if (opts.showMenu) return makeFacetResponse({ selectHonda: true, selectCivic: true, count: 3 });
      return { Count: 3, SearchResults: [1, 2, 3].map((id) => rawListing({ id })) };
    });
    return { search } as unknown as WebmotorsClient & { search: ReturnType<typeof vi.fn> };
  }

  function mapCache(): SearchCache {
    const data = new Map<string, unknown>();
    return {
      get: async <T,>(key: string) => structuredClone(data.get(key)) as T | undefined,
      set: (key, value) => void data.set(key, structuredClone(value)),
    };
  }

  it('serves a reloaded page from the cache without requests', async () => {
    const cache = mapCache();
    const first = fakeClient();
    const a = new SearchSession(state, first, cache);
    await a.root();
    await a.mainStore().ensureAll();
    expect(first.search).toHaveBeenCalledTimes(2);

    const second = fakeClient();
    const b = new SearchSession(state, second, cache);
    expect((await b.root()).Count).toBe(3);
    await b.mainStore().ensureAll();
    expect(b.mainStore().items.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(second.search).not.toHaveBeenCalled();
  });

  it('keeps only the facets the extension reads', async () => {
    const cache = mapCache();
    const session = new SearchSession(state, fakeClient(), cache);
    const root = await session.root();
    expect(root.Filters?.every((f) => f.name === 'Make' || f.name === 'YearModel')).toBe(true);
    expect(root.SearchResults).toEqual([]);
  });
});

describe('readServerSearch', () => {
  function page(pageProps: unknown): Document {
    const doc = document.implementation.createHTMLDocument('t');
    const script = doc.createElement('script');
    script.id = '__NEXT_DATA__';
    script.type = 'application/json';
    script.textContent = JSON.stringify({ props: { pageProps } });
    doc.body.append(script);
    return doc;
  }

  it('reads the count and facets the page was rendered with', () => {
    const facets = makeFacetResponse({ selectHonda: true, count: 10 }).Filters;
    const result = readServerSearch(page({ count: 2011, searchFilters: facets, url: '/carros/sp?marca1=HONDA' }));
    expect(result?.url).toBe('/carros/sp?marca1=HONDA');
    expect(result?.response.Count).toBe(2011);
    expect(result?.response.Filters?.find((f) => f.name === 'Make')).toBeTruthy();
  });

  it('ignores pages without usable data', () => {
    expect(readServerSearch(page({ count: 'x', searchFilters: [], url: '/carros/sp' }))).toBeUndefined();
    expect(readServerSearch(page({ count: 3, searchFilters: [{ name: 'Color', items: [] }], url: '/carros/sp' }))).toBeUndefined();
    const facets = makeFacetResponse({ count: 1 }).Filters;
    expect(readServerSearch(page({ count: 3, searchFilters: facets }))).toBeUndefined();
    expect(readServerSearch(document.implementation.createHTMLDocument('empty'))).toBeUndefined();
  });

  it('saves the first request of a session', async () => {
    const client = { search: vi.fn() } as unknown as WebmotorsClient;
    const session = new SearchSession(parseSearchUrl('/carros/sp?marca1=HONDA'), client);
    session.seedRoot(makeFacetResponse({ selectHonda: true, count: 7 }));
    expect((await session.root()).Count).toBe(7);
    expect(client.search).not.toHaveBeenCalled();
  });
});
