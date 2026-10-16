import { sendMessage } from '../../lib/messaging';

/** Where SearchSession keeps responses between page loads. */
export interface SearchCache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): void;
}

export const NO_CACHE: SearchCache = {
  get: () => Promise.resolve(undefined),
  set: () => undefined,
};

/** The service worker's ResponseCache: shared by every tab, survives reloads. */
export const sharedSearchCache: SearchCache = {
  async get<T>(key: string): Promise<T | undefined> {
    try {
      return ((await sendMessage('cache:get', { key })) ?? undefined) as T | undefined;
    } catch {
      return undefined;
    }
  },
  set(key, value) {
    void sendMessage('cache:set', { key, value }).catch(() => undefined);
  },
};
