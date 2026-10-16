import { browser } from 'wxt/browser';

/**
 * Two-level cache for the service worker: an in-memory map (the worker is
 * short-lived) backed by `storage.local`. Entries carry an expiry timestamp.
 */
export class PersistentCache {
  private readonly memory = new Map<string, { value: unknown; expires: number }>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly prefix = 'fipe:') {}

  async get<T>(key: string): Promise<T | undefined> {
    const now = Date.now();
    const hit = this.memory.get(key);
    if (hit && hit.expires > now) return hit.value as T;
    const storageKey = this.prefix + key;
    const stored = (await browser.storage.local.get(storageKey))[storageKey] as
      | { value: T; expires: number }
      | undefined;
    if (stored && stored.expires > now) {
      this.memory.set(key, stored);
      return stored.value;
    }
    return undefined;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const entry = { value, expires: Date.now() + ttlMs };
    this.memory.set(key, entry);
    await browser.storage.local.set({ [this.prefix + key]: entry });
  }

  /** Cached value, or computes it once even under concurrent callers. */
  async getOrCompute<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const promise = compute()
      .then(async (value) => {
        await this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  /** Drops every persisted entry whose key does not start with one of `keep`. */
  async prune(keep: string[]): Promise<void> {
    const all = await browser.storage.local.get(null);
    const stale = Object.keys(all).filter(
      (k) => k.startsWith(this.prefix) && !keep.some((p) => k.startsWith(this.prefix + p)),
    );
    for (const key of [...this.memory.keys()]) {
      if (!keep.some((p) => key.startsWith(p))) this.memory.delete(key);
    }
    if (stale.length) await browser.storage.local.remove(stale);
  }
}
