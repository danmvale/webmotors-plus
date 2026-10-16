import { storage } from 'wxt/utils/storage';
import { circuitOpenUntil, setCircuitLocally } from '../circuit';
import { AUTOCOMPLETE_TTL_MS, MIN_SPACING_MS, PX_COOLDOWN_MS, WM_ORIGIN } from '../config';
import { sendMessage } from '../messaging';
import { HttpError, isPxBlock, PxBlockedError } from './px';
import { abortError, type Priority, RequestScheduler } from './scheduler';
import { type ApiOptions, type SearchState, toApiUrl } from './search-url';
import type { AutocompleteBrand, GenAiResponse, SearchResponse } from './types';

export interface RequestControl {
  priority?: Priority;
  signal?: AbortSignal;
}

export type VehicleType = 'car' | 'bike';

/**
 * Same-origin calls to Webmotors' own API from the content script, so the
 * user's session cookies (including the bot-protection ones) are sent.
 */
export class WebmotorsClient {
  constructor(
    private readonly scheduler: RequestScheduler,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly reportBlocked: () => Promise<number> = defaultReportBlocked,
  ) {}

  search(state: SearchState, opts: ApiOptions, ctl: RequestControl = {}): Promise<SearchResponse> {
    return this.getJson<SearchResponse>(toApiUrl(state, opts), ctl);
  }

  autocomplete(ctl: RequestControl = {}): Promise<AutocompleteBrand[]> {
    return this.getJson<AutocompleteBrand[]>(`${WM_ORIGIN}/api/filter/car/autocomplete`, ctl);
  }

  /** The homepage's AI search: returns the results URL the site would navigate to. */
  async genAiSearch(prompt: string, vehicleType: VehicleType, signal?: AbortSignal): Promise<string> {
    const body = await this.scheduler.schedule(
      () =>
        this.request<GenAiResponse>(`${WM_ORIGIN}/api/gen-ai/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ prompt, vehicleType }),
          signal,
        }),
      { priority: 'high', immediate: true, signal },
    );
    const url = body.response?.url;
    if (!body.success || !url) throw new Error(body.message || 'Não foi possível interpretar sua busca.');
    return url;
  }

  private getJson<T>(url: string, ctl: RequestControl): Promise<T> {
    return this.scheduler.schedule(
      () => this.request<T>(url, { headers: { Accept: 'application/json' }, signal: ctl.signal }),
      { priority: ctl.priority ?? 'low', signal: ctl.signal },
    );
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(url, { credentials: 'same-origin', ...init });
    if (await isPxBlock(response)) {
      const openUntil = await this.reportBlocked();
      throw new PxBlockedError(openUntil);
    }
    if (!response.ok) throw new HttpError(response.status);
    return (await response.json()) as T;
  }
}

async function defaultReportBlocked(): Promise<number> {
  try {
    const { openUntil } = await sendMessage('wm:blocked');
    setCircuitLocally(openUntil);
    return openUntil;
  } catch {
    const openUntil = Date.now() + PX_COOLDOWN_MS;
    setCircuitLocally(openUntil);
    return openUntil;
  }
}

export function createScheduler(): RequestScheduler {
  return new RequestScheduler({
    minSpacingMs: MIN_SPACING_MS,
    whenReady: whenVisible,
    acquire: async () => {
      try {
        return (await sendMessage('wm:acquire')).delayMs;
      } catch {
        // Service worker unavailable (e.g. extension reloaded): local spacing still applies.
        return 0;
      }
    },
    blockedUntil: circuitOpenUntil,
    onBlocked: (until) => new PxBlockedError(until),
  });
}

/** Background crawling pauses while the tab is hidden: nobody is looking at it. */
function whenVisible(signal?: AbortSignal): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      document.removeEventListener('visibilitychange', onChange);
      signal?.removeEventListener('abort', onAbort);
    };
    const onChange = () => {
      if (document.visibilityState !== 'visible') return;
      done();
      resolve();
    };
    const onAbort = () => {
      done();
      reject(abortError());
    };
    document.addEventListener('visibilitychange', onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

let sharedClient: WebmotorsClient | undefined;

export function getClient(): WebmotorsClient {
  sharedClient ??= new WebmotorsClient(createScheduler());
  return sharedClient;
}

const autocompleteCache = storage.defineItem<{ at: number; data: AutocompleteBrand[] } | null>(
  'local:wmAutocomplete',
  { fallback: null },
);

let autocompletePromise: Promise<AutocompleteBrand[]> | undefined;

/** Brand → model list (137 brands), cached for a day across tabs. */
export function getAutocomplete(client: WebmotorsClient = getClient()): Promise<AutocompleteBrand[]> {
  autocompletePromise ??= (async () => {
    const cached = await autocompleteCache.getValue();
    if (cached && Date.now() - cached.at < AUTOCOMPLETE_TTL_MS && cached.data.length) return cached.data;
    const data = (await client.autocomplete({ priority: 'high' })).map((b) => ({
      name: b.name,
      items: (b.items ?? []).map((m) => ({ name: m.name })),
    }));
    await autocompleteCache.setValue({ at: Date.now(), data });
    return data;
  })().catch((error: unknown) => {
    autocompletePromise = undefined;
    throw error;
  });
  return autocompletePromise;
}
