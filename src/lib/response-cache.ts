/** The subset of `chrome.storage.StorageArea` the cache needs (easy to fake in tests). */
export interface CacheArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface IndexEntry {
  at: number;
  size: number;
}

const PREFIX = 'wmResponse:';
const INDEX_KEY = 'wmResponseIndex';

/**
 * Search responses kept in `storage.session` (in memory, cleared when the
 * browser closes) so a reload or a "back" from an ad page costs no request.
 * Lives in the service worker: a single writer keeps the size index exact.
 * Entries expire after `ttlMs`; the oldest are evicted beyond `maxBytes`.
 */
export class ResponseCache {
  private index: Promise<Map<string, IndexEntry>> | undefined;

  constructor(
    private readonly area: CacheArea,
    private readonly ttlMs: number,
    private readonly maxBytes: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get(key: string): Promise<unknown> {
    const index = await this.loadIndex();
    const entry = index.get(key);
    if (!entry || this.now() - entry.at > this.ttlMs) return null;
    const stored = await this.area.get(PREFIX + key);
    return stored[PREFIX + key] ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const size = JSON.stringify(value).length;
    if (size > this.maxBytes / 4) return;
    const index = await this.loadIndex();
    index.delete(key);
    index.set(key, { at: this.now(), size });

    // Map order is insertion order, i.e. oldest first.
    let total = 0;
    for (const entry of index.values()) total += entry.size;
    const evicted: string[] = [];
    for (const [k, entry] of index) {
      if (k === key) continue;
      if (total <= this.maxBytes && this.now() - entry.at <= this.ttlMs) continue;
      index.delete(k);
      total -= entry.size;
      evicted.push(PREFIX + k);
    }

    try {
      if (evicted.length) await this.area.remove(evicted);
      await this.area.set({ [PREFIX + key]: value, [INDEX_KEY]: [...index] });
    } catch {
      // Quota or storage failure: forget everything rather than keep a wrong index.
      this.index = undefined;
      await this.area.remove([INDEX_KEY]).catch(() => undefined);
    }
  }

  private loadIndex(): Promise<Map<string, IndexEntry>> {
    this.index ??= this.area
      .get(INDEX_KEY)
      .then((stored) => new Map(Array.isArray(stored[INDEX_KEY]) ? (stored[INDEX_KEY] as Array<[string, IndexEntry]>) : []))
      .catch(() => new Map<string, IndexEntry>());
    return this.index;
  }
}
