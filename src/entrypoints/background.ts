import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { storage } from 'wxt/utils/storage';
import { circuitItem } from '../lib/circuit';
import {
  GLOBAL_BURST,
  GLOBAL_RATE_PER_MIN,
  GLOBAL_SUSTAINED_BURST,
  GLOBAL_SUSTAINED_RATE_PER_MIN,
  PX_COOLDOWN_MS,
  SEARCH_CACHE_MAX_BYTES,
  SEARCH_CACHE_TTL_MS,
} from '../lib/config';
import { registerHandlers } from '../lib/messaging';
import { type BucketState, TokenBucket } from '../lib/rate-limit';
import { ResponseCache } from '../lib/response-cache';
import { PersistentCache } from '../features/fipe/cache';
import { OfficialFipeSource, ParallelumFipeSource } from '../features/fipe/fipe-api';
import { FipeResolver } from '../features/fipe/resolver';

const FIPE_ALARM = 'fipe-reference';

/** The service worker sleeps after 30 s idle; the budget must outlive it. */
const bucketsItem = storage.defineItem<{ shortTerm: BucketState; sustained: BucketState } | null>('session:wmBuckets', {
  fallback: null,
});

export default defineBackground(() => {
  // One request budget shared by every Webmotors tab: a per-minute rate and a
  // longer-term one, so a long browsing session never looks like a crawler.
  const shortTerm = new TokenBucket(GLOBAL_RATE_PER_MIN, GLOBAL_BURST);
  const sustained = new TokenBucket(GLOBAL_SUSTAINED_RATE_PER_MIN, GLOBAL_SUSTAINED_BURST);
  const bucketsReady = bucketsItem.getValue().then((saved) => {
    shortTerm.restore(saved?.shortTerm);
    sustained.restore(saved?.sustained);
  });
  const responses = new ResponseCache(browser.storage.session, SEARCH_CACHE_TTL_MS, SEARCH_CACHE_MAX_BYTES);
  const fipe = new FipeResolver(new OfficialFipeSource(), new ParallelumFipeSource(), new PersistentCache());

  registerHandlers({
    'wm:acquire': async () => {
      await bucketsReady.catch(() => undefined);
      const delayMs = Math.max(shortTerm.reserve(), sustained.reserve());
      void bucketsItem.setValue({ shortTerm: shortTerm.state, sustained: sustained.state });
      return { delayMs };
    },
    'wm:blocked': async () => {
      const current = await circuitItem.getValue();
      const openUntil = Math.max(current.openUntil, Date.now() + PX_COOLDOWN_MS);
      await circuitItem.setValue({ openUntil });
      return { openUntil };
    },
    'wm:reset': async () => {
      await circuitItem.setValue({ openUntil: 0 });
    },
    'fipe:resolve': (query) => fipe.resolve(query),
    'cache:get': ({ key }) => responses.get(key),
    'cache:set': async ({ key, value }) => {
      await responses.set(key, value);
    },
  });

  if (import.meta.env.MODE === 'development') {
    // `pnpm build:dev` has no dev server: let the page ask for a reload from disk.
    browser.runtime.onMessage.addListener((message: unknown) => {
      if ((message as { type?: string } | undefined)?.type === 'dev:reload') browser.runtime.reload();
      return false;
    });
  }

  void browser.alarms.get(FIPE_ALARM).then((alarm) => {
    if (!alarm) void browser.alarms.create(FIPE_ALARM, { periodInMinutes: 12 * 60, delayInMinutes: 1 });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FIPE_ALARM) void fipe.refreshReference().catch(() => undefined);
  });
});
