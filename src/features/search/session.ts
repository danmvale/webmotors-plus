import { toListingLite } from '../../lib/webmotors/listing';
import type { WebmotorsClient } from '../../lib/webmotors/client';
import type { Priority } from '../../lib/webmotors/scheduler';
import { nameKey } from '../../lib/webmotors/slug';
import {
  groupKey,
  narrowingPredicate,
  type SearchGroup,
  searchKey,
  type SearchState,
  withGroups,
} from '../../lib/webmotors/search-url';
import type { FacetItem, ListingLite, SearchResponse } from '../../lib/webmotors/types';
import type { Blacklist } from '../blacklist/blacklist';
import { brandsNeedingModelFacet, exclusionCount, findItem, makeFacet } from './facets';
import { type Chunk, ListingStore } from './listing-store';
import { NO_CACHE, type SearchCache } from './search-cache';

/** Facets the extension reads (the response carries ~30 more). */
const USED_FACETS = new Set(['Make', 'YearModel']);

/** Groups that restrict `state` to one brand (and optionally one model). */
export function groupsFor(state: SearchState, make: string, model?: string): SearchGroup[] {
  const same = (a: string | undefined, b: string) => a !== undefined && nameKey(a) === nameKey(b);
  const groups: SearchGroup[] = [];
  for (const g of state.groups) {
    if (!same(g.make, make)) continue;
    if (!model) groups.push(g);
    else if (!g.model) groups.push({ make: g.make, model });
    else if (same(g.model, model)) groups.push(g);
  }
  return groups.length ? groups : [{ make, model }];
}

interface StoreEntry {
  query: SearchState;
  order: number;
  store: ListingStore;
}

/**
 * Everything fetched for one result set (same filters, any page/order/blacklist):
 * the facet root, per-brand facets and listing stores. Cached in `SessionCache`
 * so going back to a previous search costs nothing.
 */
export class SearchSession {
  readonly key: string;
  private rootPromise: Promise<SearchResponse> | undefined;
  private readonly brandFacets = new Map<string, Promise<FacetItem[]>>();
  private readonly stores = new Map<string, StoreEntry>();
  private readonly controller = new AbortController();

  constructor(
    readonly state: SearchState,
    private readonly client: WebmotorsClient,
    private readonly cache: SearchCache = NO_CACHE,
  ) {
    this.key = searchKey(state);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Count + facets for the whole search (one listing, `showMenu=true`). */
  root(priority: Priority = 'low'): Promise<SearchResponse> {
    this.rootPromise ??= this.facets(this.state, priority).catch((error: unknown) => {
        this.rootPromise = undefined;
        throw error;
      });
    return this.rootPromise;
  }

  /** Uses the count and facets the page was rendered with instead of requesting them. */
  seedRoot(response: SearchResponse): void {
    this.rootPromise ??= Promise.resolve(trimFacets(response));
  }

  /** Models of a brand within this search, with exact counts. */
  brandModels(make: string, priority: Priority = 'low'): Promise<FacetItem[]> {
    const key = nameKey(make);
    let promise = this.brandFacets.get(key);
    if (!promise) {
      const selected = this.state.groups.some((g) => nameKey(g.make) === key);
      promise = (
        selected ? this.root(priority) : this.facets(withGroups(this.state, [{ make }]), priority)
      )
        .then((response) => findItem(makeFacet(response), make)?.items ?? [])
        .catch((error: unknown) => {
          this.brandFacets.delete(key);
          throw error;
        });
      this.brandFacets.set(key, promise);
    }
    return promise;
  }

  /** Results hidden by `blacklist` (exact, from facet counts). */
  async excludedCount(blacklist: Blacklist, priority: Priority = 'low'): Promise<number> {
    const root = await this.root(priority);
    const stateWithBlacklist = { ...this.state, blacklist };
    const brands = brandsNeedingModelFacet(stateWithBlacklist);
    const models = new Map<string, FacetItem[] | undefined>();
    for (const make of brands) models.set(make, await this.brandModels(make, priority));
    return exclusionCount(stateWithBlacklist, root, models, blacklist);
  }

  /** Listings of the whole search, in the given server order. */
  mainStore(order = this.state.order): ListingStore {
    return this.storeFor(this.state, order, `main:${order}`);
  }

  /** Listings of one model within this search (order irrelevant: used for the tree). */
  modelStore(make: string, model: string): ListingStore {
    const groups = groupsFor(this.state, make, model);
    if (sameGroups(groups, this.state.groups)) {
      // The search *is* this model: reuse its listings, in whichever order they were fetched.
      const complete = [...this.stores.entries()].find(([key, e]) => key.startsWith('main:') && e.store.complete);
      return complete?.[1].store ?? this.mainStore();
    }
    return this.storeFor(withGroups(this.state, groups), 1, `model:${nameKey(make)}|${nameKey(model)}`);
  }

  /** Model-year counts of one model, within the search's own year range. */
  async modelYearCounts(make: string, model: string, priority: Priority = 'low'): Promise<Array<{ year: number; count: number }>> {
    const query = withGroups(this.state, groupsFor(this.state, make, model));
    const response = await this.facets(query, priority);
    const from = Number(this.state.params.get('anode')) || 0;
    const to = Number(this.state.params.get('anoate')) || Number.POSITIVE_INFINITY;
    return (response.Filters?.find((f) => f.name === 'YearModel')?.items ?? [])
      .map((item) => ({ year: Number.parseInt(item.name, 10), count: item.count }))
      .filter((y) => y.year >= from && y.year <= to && y.count > 0)
      .sort((a, b) => b.year - a.year);
  }

  /** Listings of one model and model year (used when a model exceeds the API window). */
  modelYearStore(make: string, model: string, year: number): ListingStore {
    const base = withGroups(this.state, groupsFor(this.state, make, model));
    const params = new URLSearchParams(base.params);
    params.set('anode', String(year));
    params.set('anoate', String(year));
    return this.storeFor({ ...base, params }, 1, `model:${nameKey(make)}|${nameKey(model)}|${year}`);
  }

  /** Stores already fully fetched (for narrowing reuse by later sessions). */
  completeStores(): StoreEntry[] {
    return [...this.stores.values()].filter((e) => e.store.complete);
  }

  /** Seeds this session from a finished store of a broader search. */
  adoptFrom(parent: SearchSession): void {
    for (const entry of parent.completeStores()) {
      const predicate = narrowingPredicate(entry.query, this.state);
      if (!predicate) continue;
      const key = `main:${entry.order}`;
      if (this.stores.has(key)) continue;
      this.stores.set(key, {
        query: this.state,
        order: entry.order,
        store: ListingStore.fromItems(entry.store.items.filter(predicate)),
      });
    }
  }

  dispose(): void {
    this.controller.abort();
    for (const entry of this.stores.values()) entry.store.dispose();
  }

  private storeFor(query: SearchState, order: number, key: string): ListingStore {
    let entry = this.stores.get(key);
    if (!entry) {
      const store = new ListingStore((page, perPage, priority, signal) =>
        this.cached<Chunk>(`chunk|${searchKey(query)}|o${order}|n${perPage}|p${page}`, () =>
          this.client
            .search(query, { page, perPage, showMenu: false, order }, { priority, signal: anySignal(signal, this.signal) })
            .then((response) => ({
              count: response.Count,
              items: response.SearchResults.map(toListingLite).filter((l): l is ListingLite => l !== null),
            })),
        ),
      );
      entry = { query, order, store };
      this.stores.set(key, entry);
    }
    return entry.store;
  }

  /** Count + the facets we use, for one listing of `query` (`showMenu=true`). */
  private facets(query: SearchState, priority: Priority): Promise<SearchResponse> {
    return this.cached(`facets|${searchKey(query)}`, async () => {
      const response = await this.client.search(
        query,
        { page: 1, perPage: 1, showMenu: true, order: 1 },
        { priority, signal: this.signal },
      );
      return trimFacets(response);
    });
  }

  /** Reuses a response fetched by an earlier page load (reload, back from an ad, other tab). */
  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await load();
    this.cache.set(key, value);
    return value;
  }
}

function sameGroups(a: SearchGroup[], b: SearchGroup[]): boolean {
  const key = (groups: SearchGroup[]) => groups.map(groupKey).sort().join('|');
  return key(a) === key(b);
}

function trimFacets(response: SearchResponse): SearchResponse {
  return {
    Count: response.Count,
    Filters: response.Filters?.filter((f) => USED_FACETS.has(f.name)),
    SearchResults: [],
  };
}

function anySignal(...signals: AbortSignal[]): AbortSignal {
  return AbortSignal.any(signals);
}

/** Small LRU of sessions keyed by result set. */
export class SessionCache {
  private readonly sessions = new Map<string, SearchSession>();

  constructor(
    private readonly client: WebmotorsClient,
    private readonly capacity = 4,
    private readonly cache: SearchCache = NO_CACHE,
  ) {}

  get(state: SearchState): SearchSession {
    const key = searchKey(state);
    let session = this.sessions.get(key);
    if (session) {
      this.sessions.delete(key);
      this.sessions.set(key, session);
      return session;
    }
    session = new SearchSession(state, this.client, this.cache);
    for (const previous of [...this.sessions.values()].reverse()) session.adoptFrom(previous);
    this.sessions.set(key, session);
    while (this.sessions.size > this.capacity) {
      const oldest = this.sessions.keys().next().value as string;
      this.sessions.get(oldest)?.dispose();
      this.sessions.delete(oldest);
    }
    return session;
  }
}
