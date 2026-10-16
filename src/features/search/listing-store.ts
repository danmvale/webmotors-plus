import { CHUNK_SIZE, RESULT_WINDOW } from '../../lib/config';
import type { Priority } from '../../lib/webmotors/scheduler';
import type { ListingLite } from '../../lib/webmotors/types';

export interface Chunk {
  items: ListingLite[];
  count: number;
}

export type ChunkFetcher = (page: number, perPage: number, priority: Priority, signal: AbortSignal) => Promise<Chunk>;

export interface EnsureOptions {
  priority?: Priority;
  signal?: AbortSignal;
}

/**
 * Listings of one query in server order, fetched in large chunks on demand and
 * shared by the filtered results list and the tree panel.
 */
export class ListingStore {
  readonly items: ListingLite[] = [];
  /** Server-side `Count` (may exceed what is reachable, see RESULT_WINDOW). */
  count: number | undefined;
  private readonly ids = new Set<number>();
  private nextPage = 1;
  private exhausted = false;
  private inflight: Promise<void> | undefined;
  private readonly controller = new AbortController();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly fetchChunk: ChunkFetcher,
    private readonly chunkSize = CHUNK_SIZE,
    private readonly window = RESULT_WINDOW,
  ) {}

  /** A complete store built from already-known listings (narrowing reuse). */
  static fromItems(items: Iterable<ListingLite>): ListingStore {
    const store = new ListingStore(() => Promise.reject(new Error('complete store')));
    for (const item of items) store.add(item);
    store.count = store.items.length;
    store.exhausted = true;
    return store;
  }

  get complete(): boolean {
    return this.exhausted;
  }

  /** How many listings the API can actually return for this query. */
  get reachable(): number | undefined {
    return this.count === undefined ? undefined : Math.min(this.count, this.window);
  }

  /** True when the query has more results than the API lets anyone page through. */
  get truncated(): boolean {
    return this.count !== undefined && this.count > this.window;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.controller.abort();
    this.listeners.clear();
  }

  async ensure(n: number, opts: EnsureOptions = {}): Promise<void> {
    while (this.items.length < n && !this.exhausted) {
      opts.signal?.throwIfAborted();
      await this.fetchNext(opts.priority ?? 'low');
    }
  }

  /** Fetches until `n` listings satisfy `predicate` (or results run out). */
  async ensureMatching(predicate: (l: ListingLite) => boolean, n: number, opts: EnsureOptions = {}): Promise<void> {
    let matched = 0;
    let scanned = 0;
    for (;;) {
      for (; scanned < this.items.length; scanned++) if (predicate(this.items[scanned]!)) matched++;
      if (matched >= n || this.exhausted) return;
      opts.signal?.throwIfAborted();
      await this.fetchNext(opts.priority ?? 'low');
    }
  }

  async ensureAll(opts: EnsureOptions = {}): Promise<void> {
    await this.ensure(Number.POSITIVE_INFINITY, opts);
  }

  private fetchNext(priority: Priority): Promise<void> {
    this.inflight ??= (async () => {
      try {
        const page = this.nextPage;
        const chunk = await this.fetchChunk(page, this.chunkSize, priority, this.controller.signal);
        this.count = chunk.count;
        for (const item of chunk.items) this.add(item);
        this.nextPage = page + 1;
        const reachable = Math.min(chunk.count, this.window);
        if (chunk.items.length < this.chunkSize || page * this.chunkSize >= reachable) this.exhausted = true;
        for (const listener of [...this.listeners]) listener();
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }

  private add(item: ListingLite): void {
    if (this.ids.has(item.id)) return;
    this.ids.add(item.id);
    this.items.push(item);
  }
}
