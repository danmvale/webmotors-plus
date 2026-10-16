import { describe, expect, it, vi } from 'vitest';
import { type ChunkFetcher, ListingStore } from '../src/features/search/listing-store';
import { toListingLite } from '../src/lib/webmotors/listing';
import type { ListingLite } from '../src/lib/webmotors/types';
import { rawListing } from './fixtures/search';

function server(total: number, opts: { makeOf?: (i: number) => string; window?: number } = {}): ChunkFetcher {
  const all: ListingLite[] = Array.from({ length: total }, (_, i) =>
    toListingLite(rawListing({ id: i + 1, make: opts.makeOf?.(i) ?? 'HONDA' }))!,
  );
  const window = opts.window ?? 10_000;
  return async (page, perPage) => {
    const start = (page - 1) * perPage;
    // Past the window the real API repeats page 1.
    const slice = start >= window ? all.slice(0, Math.min(10, perPage)) : all.slice(start, Math.min(start + perPage, window));
    return { items: slice, count: total };
  };
}

describe('ListingStore', () => {
  it('fetches only the chunks needed', async () => {
    const fetcher = vi.fn(server(1200));
    const store = new ListingStore(fetcher, 500);
    await store.ensure(47);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.items).toHaveLength(500);
    expect(store.complete).toBe(false);
    await store.ensureAll();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(store.items).toHaveLength(1200);
    expect(store.complete).toBe(true);
  });

  it('fills a page of matching listings, skipping excluded ones', async () => {
    const fetcher = vi.fn(server(2000, { makeOf: (i) => (i % 2 ? 'FIAT' : 'HONDA') }));
    const store = new ListingStore(fetcher, 500);
    await store.ensureMatching((l) => l.make !== 'FIAT', 47 * 6);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.items.filter((l) => l.make !== 'FIAT').length).toBeGreaterThanOrEqual(282);
  });

  it('stops at the 10,000-result window and ignores repeated pages', async () => {
    const fetcher = vi.fn(server(12_000));
    const store = new ListingStore(fetcher, 500);
    await store.ensureAll();
    expect(fetcher).toHaveBeenCalledTimes(20);
    expect(store.items).toHaveLength(10_000);
    expect(store.truncated).toBe(true);
    expect(store.reachable).toBe(10_000);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const fetcher = vi.fn(server(600));
    const store = new ListingStore(fetcher, 500);
    await Promise.all([store.ensure(10), store.ensure(20)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('builds complete stores from known listings', () => {
    const items = Array.from({ length: 3 }, (_, i) => toListingLite(rawListing({ id: 100 + i }))!);
    const store = ListingStore.fromItems([...items, items[0]!]);
    expect(store.complete).toBe(true);
    expect(store.items).toHaveLength(3);
  });
});
