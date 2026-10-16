import { EAGER_LIMIT, MODEL_CRAWL_LIMIT } from '../../lib/config';
import { sendMessage } from '../../lib/messaging';
import { Store } from '../../lib/store';
import { isAbortError, PxBlockedError } from '../../lib/webmotors/px';
import { nameKey } from '../../lib/webmotors/slug';
import { narrowingPredicate, type SearchState } from '../../lib/webmotors/search-url';
import type { FacetItem, ListingLite } from '../../lib/webmotors/types';
import { createExclusionTest, type ExclusionTest } from '../blacklist/blacklist';
import type { FipeResult } from '../fipe/types';
import { findItem, makeFacet } from '../search/facets';
import type { SearchSession } from '../search/session';
import { aggregate, byName, type YearAgg } from './aggregate';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'blocked';

/** A model year; for large models its versions load when it is expanded. */
export interface YearNode extends YearAgg {
  status?: LoadStatus;
}

export interface ModelNode {
  name: string;
  count: number;
  years?: YearNode[];
  /** Years come from facet counts; each year's versions load on demand. */
  lazyYears?: boolean;
  /** Model has more listings than the API can page through even per year. */
  partial?: boolean;
  status: LoadStatus;
}

export interface MakeNode {
  name: string;
  count: number;
  models?: ModelNode[];
  status: LoadStatus;
}

export interface TreeState {
  status: LoadStatus;
  mode?: 'eager' | 'lazy';
  /** Results after the blacklist. */
  total?: number;
  progress?: { loaded: number; total: number };
  makes: MakeNode[];
  blockedUntil?: number;
  error?: string;
}

export type FipeCell =
  | { status: 'loading' }
  | { status: 'done'; result: FipeResult }
  | { status: 'none' }
  | { status: 'error' };

export const pathKey = (...parts: Array<string | number>) => parts.map((p) => nameKey(String(p))).join('›');

const INITIAL: TreeState = { status: 'idle', makes: [] };

/**
 * Loads the Marca › Modelo › Ano › Versão tree for the current search.
 * Small searches are crawled completely (instant expansion); large ones use
 * facet counts for brands/models and crawl a model only when it is expanded.
 */
export class TreeController {
  readonly state = new Store<TreeState>(INITIAL);
  readonly expanded = new Store<ReadonlySet<string>>(new Set());
  readonly fipe = new Store<ReadonlyMap<string, FipeCell>>(new Map());

  private session: SearchSession | undefined;
  private search: SearchState | undefined;
  private exclude: ExclusionTest = () => false;
  private run = 0;

  load(session: SearchSession, search: SearchState): void {
    const sameSession = session === this.session;
    const previous = this.search;
    this.session = session;
    this.search = search;
    this.exclude = createExclusionTest(search.blacklist);
    if (!sameSession) {
      // A narrower search (e.g. a click in the tree) keeps the user's place in it.
      const narrowed = previous && narrowingPredicate(previous, search);
      if (!narrowed) this.expanded.set(new Set());
      this.state.set({ status: 'loading', makes: [] });
    }
    void this.start(++this.run);
  }

  retry(): void {
    if (this.session && this.search) {
      this.state.set({ ...this.state.get(), status: 'loading', error: undefined, blockedUntil: undefined });
      void this.start(++this.run);
    }
  }

  retryYear(make: string, model: string, year: number): void {
    void this.openYear(make, model, year);
  }

  isExpanded(key: string): boolean {
    return this.expanded.get().has(key);
  }

  toggle(key: string, node: { kind: 'make'; make: string } | { kind: 'model'; make: string; model: string } | { kind: 'year'; make: string; model: string; year: YearAgg }): void {
    const next = new Set(this.expanded.get());
    const opening = !next.has(key);
    if (opening) next.add(key);
    else next.delete(key);
    this.expanded.set(next);
    if (!opening) return;
    if (node.kind === 'make') void this.loadModels(node.make);
    else if (node.kind === 'model') void this.loadYears(node.make, node.model);
    else void this.openYear(node.make, node.model, node.year.year);
  }

  private stale(run: number): boolean {
    return run !== this.run;
  }

  private async start(run: number): Promise<void> {
    const session = this.session!;
    const search = this.search!;
    try {
      const main = session.mainStore(search.order);
      if (main.complete) return this.showEager(main.items, main.items.length, run);

      const root = await session.root();
      if (this.stale(run)) return;
      if (root.Count <= EAGER_LIMIT) {
        this.state.set({ ...this.state.get(), status: 'loading', mode: 'eager', progress: { loaded: main.items.length, total: root.Count } });
        const unsubscribe = main.subscribe(() => {
          if (!this.stale(run)) this.showEager(main.items, root.Count, run, !main.complete);
        });
        try {
          await main.ensureAll({ signal: session.signal });
        } finally {
          unsubscribe();
        }
        if (!this.stale(run)) this.showEager(main.items, main.items.length, run);
        return;
      }

      // Lazy mode: brands from facet counts.
      const excluded = await session.excludedCount(search.blacklist);
      if (this.stale(run)) return;
      const makes = this.lazyMakes(makeFacet(root));
      this.state.set({ status: 'ready', mode: 'lazy', total: Math.max(0, root.Count - excluded), makes });
      await this.restoreExpansion(run);
    } catch (error) {
      if (!this.stale(run)) this.fail(error);
    }
  }

  /** After a lazy reload (e.g. blacklist change), reopens what the user had open. */
  private async restoreExpansion(run: number): Promise<void> {
    const keys = [...this.expanded.get()].map((k) => k.split('›'));
    for (const [make] of keys.filter((parts) => parts.length === 1)) {
      if (this.stale(run) || !make) return;
      await this.loadModels(this.displayName(make));
    }
    for (const [make, model] of keys.filter((parts) => parts.length === 2)) {
      if (this.stale(run) || !make || !model) return;
      await this.loadYears(this.displayName(make), this.displayModelName(make, model));
    }
    for (const [make, model, year] of keys.filter((parts) => parts.length === 3)) {
      if (this.stale(run) || !make || !model || !year) return;
      await this.openYear(this.displayName(make), this.displayModelName(make, model), Number(year));
    }
  }

  private showEager(items: ListingLite[], serverCount: number, run: number, loading = false): void {
    if (this.stale(run)) return;
    const aggs = aggregate(items, this.exclude);
    const total = aggs.reduce((sum, m) => sum + m.count, 0);
    const makes: MakeNode[] = aggs.map((make) => ({
      name: make.name,
      count: make.count,
      status: 'ready',
      models: make.models.map((model) => ({ name: model.name, count: model.count, years: model.years, status: 'ready' })),
    }));
    this.state.set({
      status: loading ? 'loading' : 'ready',
      mode: 'eager',
      total,
      makes,
      progress: loading ? { loaded: items.length, total: serverCount } : undefined,
    });
    if (!loading) this.refreshExpandedYears();
  }

  private lazyMakes(facet: FacetItem[]): MakeNode[] {
    const search = this.search!;
    const blacklist = new Set(search.blacklist.makes.map(nameKey));
    const inGroups = (name: string) => search.groups.some((g) => nameKey(g.make) === nameKey(name));
    return facet
      .filter((item) => (search.groups.length ? inGroups(item.name) : item.count > 0))
      .filter((item) => !blacklist.has(nameKey(item.name)))
      .map((item) => ({ name: item.name, count: this.brandCount(item), status: 'idle' as const }))
      .sort(byName);
  }

  /** Result count of a brand, honoring model/version filters (facets are disjunctive). */
  private brandCount(item: FacetItem): number {
    const groups = this.search!.groups.filter((g) => nameKey(g.make) === nameKey(item.name));
    if (!groups.length || groups.some((g) => !g.model)) return item.count;
    return groups.reduce((sum, g) => {
      const model = findItem(item.items, g.model!);
      return sum + ((g.version ? findItem(model?.items, g.version)?.count : model?.count) ?? 0);
    }, 0);
  }

  /** A model's result count; if every filter on it pins versions, sum those versions. */
  private modelCount(item: FacetItem, brandGroups: SearchState['groups']): number {
    const groups = brandGroups.filter((g) => g.model && nameKey(g.model) === nameKey(item.name));
    if (!groups.length || groups.some((g) => !g.version)) return item.count;
    return groups.reduce((sum, g) => sum + (findItem(item.items, g.version!)?.count ?? 0), 0);
  }

  private async loadModels(make: string): Promise<void> {
    const node = this.findMake(make);
    if (!node || node.models || node.status === 'loading' || this.state.get().mode !== 'lazy') return;
    const run = this.run;
    this.patchMake(make, { status: 'loading' });
    try {
      const items = await this.session!.brandModels(make, 'high');
      if (this.stale(run)) return;
      const search = this.search!;
      const groups = search.groups.filter((g) => nameKey(g.make) === nameKey(make));
      const pinned = groups.length > 0 && groups.every((g) => g.model);
      const models: ModelNode[] = items
        .filter((m) => (pinned ? groups.some((g) => nameKey(g.model!) === nameKey(m.name)) : m.count > 0))
        .filter((m) => !this.exclude(make, m.name))
        .map((m) => ({ name: m.name, count: this.modelCount(m, groups), status: 'idle' as const }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
      this.patchMake(make, { status: 'ready', models });
    } catch (error) {
      if (!this.stale(run)) this.failNode(error, () => this.patchMake(make, { status: 'error' }));
    }
  }

  private async loadYears(make: string, model: string): Promise<void> {
    const node = this.findModel(make, model);
    if (!node || node.years || node.status === 'loading' || this.state.get().mode !== 'lazy') return;
    const run = this.run;
    const session = this.session!;
    this.patchModel(make, model, { status: 'loading' });
    try {
      if (node.count > MODEL_CRAWL_LIMIT) {
        // Large model: one facet request for its years; each year loads when opened.
        const years = await session.modelYearCounts(make, model, 'high');
        if (this.stale(run)) return;
        this.patchModel(make, model, {
          status: 'ready',
          lazyYears: true,
          years: years.map(({ year, count }) => ({ year, count, versions: [], status: 'idle' })),
        });
        return;
      }
      const store = session.modelStore(make, model);
      await store.ensureAll({ priority: 'high', signal: session.signal });
      if (this.stale(run)) return;
      const agg = aggregate(store.items, this.exclude)[0]?.models.find((m) => nameKey(m.name) === nameKey(model));
      this.patchModel(make, model, { status: 'ready', years: agg?.years ?? [] });
      this.refreshExpandedYears();
    } catch (error) {
      if (!this.stale(run)) this.failNode(error, () => this.patchModel(make, model, { status: 'error' }));
    }
  }

  /** Shows a year's versions: loads them first for large models, then asks for FIPE values. */
  private async openYear(make: string, model: string, year: number): Promise<void> {
    const node = this.findModel(make, model);
    const yearNode = node?.years?.find((y) => y.year === year);
    if (!node || !yearNode) return;
    if (!node.lazyYears || yearNode.status === 'ready') {
      this.requestFipe(make, node.name, yearNode);
      return;
    }
    if (yearNode.status === 'loading') return;
    const run = this.run;
    const session = this.session!;
    this.patchYear(make, model, year, { status: 'loading' });
    try {
      const store = session.modelYearStore(make, model, year);
      await store.ensureAll({ priority: 'high', signal: session.signal });
      if (this.stale(run)) return;
      const agg = aggregate(store.items, this.exclude)[0]
        ?.models.find((m) => nameKey(m.name) === nameKey(model))
        ?.years.find((y) => y.year === year);
      const loaded: YearNode = { year, count: agg?.count ?? 0, versions: agg?.versions ?? [], status: 'ready' };
      this.patchYear(make, model, year, loaded);
      if (store.truncated) this.patchModel(make, model, { partial: true });
      this.requestFipe(make, node.name, loaded);
    } catch (error) {
      if (!this.stale(run)) this.failNode(error, () => this.patchYear(make, model, year, { status: 'error' }));
    }
  }

  /** Re-requests FIPE for year nodes that are open (after data (re)loads). */
  private refreshExpandedYears(): void {
    for (const key of this.expanded.get()) {
      const [make, model, year] = key.split('›');
      if (!make || !model || !year) continue;
      const node = this.findModel(this.displayName(make), this.displayModelName(make, model));
      const yearAgg = node?.years?.find((y) => String(y.year) === year);
      if (node && yearAgg) this.requestFipe(this.displayName(make), node.name, yearAgg);
    }
  }

  private requestFipe(make: string, model: string, year: YearAgg): void {
    for (const version of year.versions) {
      const key = pathKey(make, model, year.year, version.name);
      if (this.fipe.get().has(key)) continue;
      this.setFipe(key, { status: 'loading' });
      sendMessage('fipe:resolve', {
        make,
        model,
        version: version.name,
        year: year.year,
        zeroKm: version.zeroKm,
        implied: version.implied,
        impliedSamples: version.impliedSamples,
        attrs: version.attrs,
      }).then(
        (result) => this.setFipe(key, result ? { status: 'done', result } : { status: 'none' }),
        () => this.setFipe(key, { status: 'error' }),
      );
    }
  }

  private setFipe(key: string, cell: FipeCell): void {
    const next = new Map(this.fipe.get());
    next.set(key, cell);
    this.fipe.set(next);
  }

  private fail(error: unknown): void {
    if (isAbortError(error)) return;
    if (error instanceof PxBlockedError) {
      this.state.set({ ...this.state.get(), status: 'blocked', blockedUntil: error.openUntil });
      return;
    }
    this.state.set({ ...this.state.get(), status: 'error', error: 'Não foi possível carregar os resultados.' });
  }

  private failNode(error: unknown, markError: () => void): void {
    if (isAbortError(error)) return;
    markError();
    if (error instanceof PxBlockedError) this.fail(error);
  }

  private findMake(make: string): MakeNode | undefined {
    return this.state.get().makes.find((m) => nameKey(m.name) === nameKey(make));
  }

  private findModel(make: string, model: string): ModelNode | undefined {
    return this.findMake(make)?.models?.find((m) => nameKey(m.name) === nameKey(model));
  }

  private displayName(makeKey: string): string {
    return this.state.get().makes.find((m) => nameKey(m.name) === makeKey)?.name ?? makeKey;
  }

  private displayModelName(makeKey: string, modelKey: string): string {
    return this.findMake(makeKey)?.models?.find((m) => nameKey(m.name) === modelKey)?.name ?? modelKey;
  }

  private patchMake(make: string, patch: Partial<MakeNode>): void {
    const state = this.state.get();
    this.state.set({
      ...state,
      makes: state.makes.map((m) => (nameKey(m.name) === nameKey(make) ? { ...m, ...patch } : m)),
    });
  }

  private patchYear(make: string, model: string, year: number, patch: Partial<YearNode>): void {
    const node = this.findModel(make, model);
    if (!node?.years) return;
    this.patchModel(make, model, { years: node.years.map((y) => (y.year === year ? { ...y, ...patch } : y)) });
  }

  private patchModel(make: string, model: string, patch: Partial<ModelNode>): void {
    const state = this.state.get();
    this.state.set({
      ...state,
      makes: state.makes.map((m) =>
        nameKey(m.name) !== nameKey(make)
          ? m
          : { ...m, models: m.models?.map((x) => (nameKey(x.name) === nameKey(model) ? { ...x, ...patch } : x)) },
      ),
    });
  }
}
