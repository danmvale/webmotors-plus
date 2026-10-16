import { storage } from 'wxt/utils/storage';
import { navigate, onLocationChange } from '../../lib/bridge';
import { watchCircuit } from '../../lib/circuit';
import { setRootFlag } from '../../lib/dom';
import { sendMessage } from '../../lib/messaging';
import { SEL } from '../../lib/selectors';
import { Store } from '../../lib/store';
import { getClient } from '../../lib/webmotors/client';
import {
  applyTreeTarget,
  parseSearchUrl,
  type SearchState,
  searchKey,
  toPageUrl,
  type TreeTarget,
  withBlacklist,
  withPage,
} from '../../lib/webmotors/search-url';
import {
  type Blacklist,
  EMPTY_BLACKLIST,
  encodeBlacklist,
  isBlacklistEmpty,
  sameBlacklist,
  withoutSelected,
} from '../blacklist/blacklist';
import { FilteredResultsController } from '../blacklist/results-controller';
import type { SearchSession } from '../search/session';
import { sharedSearchCache } from '../search/search-cache';
import { readServerSearch } from '../search/server-data';
import { SessionCache } from '../search/session';
import { TreeController } from '../tree/controller';

export const FILTERED_FLAG = 'data-wmp-filtered';
export const PANEL_FLAG = 'data-wmp-panel';

const panelOpenItem = storage.defineItem<boolean>('local:treePanelOpen', { fallback: true });

/**
 * State of the results page as seen by the extension: the parsed URL, the
 * session holding fetched data, and the two features built on it.
 */
export class SearchPageApp {
  readonly search: Store<SearchState>;
  readonly session: Store<SearchSession>;
  readonly tree = new TreeController();
  readonly results = new FilteredResultsController();
  readonly panelOpen = new Store(true);
  readonly notice = new Store<string | null>(null);
  readonly circuitUntil = new Store(0);

  private readonly sessions = new SessionCache(getClient(), 4, sharedSearchCache);
  private treeEnabled = false;
  private treeReady = false;
  private treeSeen = false;
  private resultsEnabled = false;
  private clearBlacklistOnNextChange = false;

  constructor(href: string) {
    const state = resolveConflicts(parseSearchUrl(href), new URL(href));
    setRootFlag(FILTERED_FLAG, isBlacklistEmpty(state.blacklist) ? null : '');
    this.search = new Store(state);
    const session = this.sessions.get(state);
    // If the page was server-rendered for this very search, its count and facets save a request.
    const server = readServerSearch();
    if (server && searchKey(parseSearchUrl(server.url)) === searchKey(state)) session.seedRoot(server.response);
    this.session = new Store(session);
  }

  start(signal: AbortSignal): void {
    const unwatch = watchCircuit((until) => this.circuitUntil.set(until));
    signal.addEventListener('abort', unwatch, { once: true });
    void panelOpenItem.getValue().then((open) => this.setPanelOpen(open, false));
    onLocationChange((href) => this.onUrl(href), signal);

    // "Limpar todos" keeps unknown params, so clear the blacklist with it.
    document.addEventListener(
      'click',
      (event) => {
        if ((event.target as Element | null)?.closest?.(SEL.filtersCleanAll)) this.clearBlacklistOnNextChange = true;
      },
      { capture: true, signal },
    );
  }

  /** Filtered results are user-visible content: start them as soon as the page has loaded. */
  enableResults(): void {
    this.resultsEnabled = true;
    this.results.load(this.session.get(), this.search.get());
  }

  /** The tree is secondary: allowed to start once the page is idle. */
  enableTree(): void {
    this.treeReady = true;
    this.startTreeIfWanted();
  }

  /** Called while a tree panel is on screen: nothing is fetched for a tree nobody sees. */
  showTree(): void {
    this.treeSeen = true;
    this.startTreeIfWanted();
  }

  private startTreeIfWanted(): void {
    if (this.treeEnabled || !this.treeReady || !this.treeSeen) return;
    this.treeEnabled = true;
    this.tree.load(this.session.get(), this.search.get());
  }

  applyBlacklist(blacklist: Blacklist): void {
    navigate(toPageUrl(withBlacklist(this.search.get(), blacklist)));
  }

  applyTreeTarget(target: TreeTarget): void {
    const change = applyTreeTarget(this.search.get(), target);
    if (change.kind === 'limit') {
      this.flash('A Webmotors permite até 3 marcas ou modelos por busca. Remova um filtro para adicionar outro.');
    } else if (change.kind === 'changed') {
      navigate(toPageUrl(change.state));
    }
  }

  goToPage(page: number): void {
    navigate(toPageUrl(withPage(this.search.get(), page)));
  }

  setPanelOpen(open: boolean, persist = true): void {
    this.panelOpen.set(open);
    setRootFlag(PANEL_FLAG, open ? 'open' : 'collapsed');
    if (persist) void panelOpenItem.setValue(open);
  }

  async retryNow(): Promise<void> {
    await sendMessage('wm:reset').catch(() => undefined);
    this.circuitUntil.set(0);
    const session = this.session.get();
    const search = this.search.get();
    if (this.resultsEnabled) this.results.retry(session, search);
    if (this.treeEnabled) this.tree.retry();
  }

  flash(message: string): void {
    this.notice.set(message);
    setTimeout(() => this.notice.get() === message && this.notice.set(null), 5000);
  }

  private onUrl(href: string): void {
    const url = new URL(href);
    if (!url.pathname.startsWith('/carros/')) return;
    let next = parseSearchUrl(url);
    const previous = this.search.get();

    // The site carries our params through its own refinements (verified), so a
    // URL without them is a new search: the blacklist ends with it.
    if (this.clearBlacklistOnNextChange) {
      this.clearBlacklistOnNextChange = false;
      if (!isBlacklistEmpty(next.blacklist)) {
        next = { ...next, blacklist: EMPTY_BLACKLIST };
        rewriteUrl(url, EMPTY_BLACKLIST);
      }
    }

    next = resolveConflicts(next, url);

    const sameKey = searchKey(next) === searchKey(previous);
    if (
      sameKey &&
      next.page === previous.page &&
      next.order === previous.order &&
      sameBlacklist(next.blacklist, previous.blacklist)
    ) {
      return;
    }

    this.search.set(next);
    setRootFlag(FILTERED_FLAG, isBlacklistEmpty(next.blacklist) ? null : '');
    const session = sameKey ? this.session.get() : this.sessions.get(next);
    this.session.set(session);
    if (this.resultsEnabled) this.results.load(session, next);
    const treeAffected = !sameKey || !sameBlacklist(next.blacklist, previous.blacklist);
    if (this.treeEnabled && treeAffected) this.tree.load(session, next);
  }
}

/** A brand or model picked in the site's own filters leaves the blacklist. */
function resolveConflicts(state: SearchState, url: URL): SearchState {
  const blacklist = withoutSelected(state.blacklist, state.groups);
  if (blacklist === state.blacklist) return state;
  if (url.href === location.href) rewriteUrl(url, blacklist);
  return { ...state, blacklist };
}

function rewriteUrl(url: URL, blacklist: Blacklist): void {
  encodeBlacklist(blacklist, url.searchParams);
  history.replaceState(history.state, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
}
