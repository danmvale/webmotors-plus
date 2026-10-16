import { PAGE_SIZE, RESULT_WINDOW } from '../../lib/config';
import { Store } from '../../lib/store';
import { isAbortError, PxBlockedError } from '../../lib/webmotors/px';
import type { SearchState } from '../../lib/webmotors/search-url';
import type { ListingLite } from '../../lib/webmotors/types';
import type { SearchSession } from '../search/session';
import { createExclusionTest, isBlacklistEmpty } from './blacklist';

export interface ResultsState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'blocked';
  page: number;
  items: ListingLite[];
  /** Results after the blacklist (exact once known). */
  total?: number;
  excluded?: number;
  totalPages?: number;
  /** The API's 10,000-result window ended before this page could be filled. */
  windowEnded: boolean;
  blockedUntil?: number;
}

const IDLE: ResultsState = { status: 'idle', page: 1, items: [], windowEnded: false };

/**
 * When a blacklist is active, serves full 47-card pages of the search minus the
 * blacklisted brands/models, in the order the user picked.
 */
export class FilteredResultsController {
  readonly state = new Store<ResultsState>(IDLE);
  private run = 0;

  load(session: SearchSession, search: SearchState): void {
    const run = ++this.run;
    if (isBlacklistEmpty(search.blacklist)) {
      this.state.set(IDLE);
      return;
    }
    const previous = this.state.get();
    this.state.set({
      ...previous,
      status: 'loading',
      page: search.page,
      items: previous.page === search.page && previous.status !== 'idle' ? previous.items : [],
    });
    void this.fill(run, session, search);
  }

  retry(session: SearchSession, search: SearchState): void {
    this.load(session, search);
  }

  private async fill(run: number, session: SearchSession, search: SearchState): Promise<void> {
    const exclude = createExclusionTest(search.blacklist);
    const keep = (l: ListingLite) => !exclude(l.make, l.model);
    const store = session.mainStore(search.order);
    const end = PAGE_SIZE * search.page;
    try {
      await store.ensureMatching(keep, end, { priority: 'high', signal: session.signal });
      if (run !== this.run) return;
      const filtered = store.items.filter(keep);
      const items = filtered.slice(end - PAGE_SIZE, end);
      this.state.set({
        ...this.state.get(),
        status: 'ready',
        items,
        windowEnded: store.complete && store.truncated && items.length < PAGE_SIZE,
        ...(store.complete && !store.truncated ? this.totals(filtered.length, store.items.length - filtered.length) : {}),
      });

      if (store.complete && !store.truncated) return;
      const [root, excluded] = await Promise.all([
        session.root('high'),
        session.excludedCount(search.blacklist, 'high'),
      ]);
      if (run !== this.run) return;
      this.state.set({ ...this.state.get(), ...this.totals(Math.max(0, root.Count - excluded), excluded) });
    } catch (error) {
      if (run !== this.run || isAbortError(error)) return;
      this.state.set({
        ...this.state.get(),
        status: error instanceof PxBlockedError ? 'blocked' : 'error',
        blockedUntil: error instanceof PxBlockedError ? error.openUntil : undefined,
      });
    }
  }

  private totals(total: number, excluded: number) {
    return {
      total,
      excluded,
      totalPages: Math.max(1, Math.ceil(Math.min(total, RESULT_WINDOW) / PAGE_SIZE)),
    };
  }
}
