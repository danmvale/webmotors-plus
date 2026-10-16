import {
  type Blacklist,
  decodeBlacklist,
  encodeBlacklist,
  isBlacklistEmpty,
} from '../../features/blacklist/blacklist';
import { BLACKLIST_PARAMS, MAX_GROUPS, WM_ORIGIN } from '../config';
import { nameKey, slugify } from './slug';

export interface SearchGroup {
  make: string;
  model?: string;
  version?: string;
}

export interface SearchState {
  /** Path segment 2: `estoque`, `sp`, `sp-campinas`, `sp-sao-paulo`… */
  location: string;
  /** Every site param except page, o, marcaN/modeloN/versaoN and our own. */
  params: URLSearchParams;
  groups: SearchGroup[];
  order: number;
  page: number;
  blacklist: Blacklist;
}

export type TreeTarget = { make: string; model?: string; version?: string };

const GROUP_PARAM = /^(marca|modelo|versao)([1-9])$/i;
const GROUP_FIELD = { marca: 'make', modelo: 'model', versao: 'version' } as const;
const OWN_PARAMS = new Set<string>([BLACKLIST_PARAMS.makes, BLACKLIST_PARAMS.models]);

export function parseSearchUrl(input: string | URL): SearchState {
  const url = new URL(input, WM_ORIGIN);
  const segments = url.pathname.split('/').filter(Boolean);
  const location = segments[1] || 'estoque';
  const params = new URLSearchParams();
  const rawGroups = new Map<number, Partial<SearchGroup>>();
  let order = 1;
  let page = 1;

  for (const [key, value] of url.searchParams) {
    const group = GROUP_PARAM.exec(key);
    if (group) {
      const index = Number(group[2]);
      const field = GROUP_FIELD[group[1]!.toLowerCase() as keyof typeof GROUP_FIELD];
      const entry = rawGroups.get(index) ?? {};
      const trimmed = value.trim();
      if (trimmed) entry[field] = trimmed;
      rawGroups.set(index, entry);
      continue;
    }
    if (key === 'page') {
      page = Math.max(1, Number.parseInt(value, 10) || 1);
      continue;
    }
    if (key === 'o') {
      order = Number.parseInt(value, 10) || 1;
      continue;
    }
    if (OWN_PARAMS.has(key)) continue;
    params.append(key, value);
  }

  const groups: SearchGroup[] = [...rawGroups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, g]) => g)
    .filter((g): g is SearchGroup => Boolean(g.make))
    .map((g) => ({ make: g.make!, model: g.model, version: g.model ? g.version : undefined }));

  return { location, params, groups, order, page, blacklist: decodeBlacklist(url.searchParams) };
}

/** Stable identity of the result set: ignores page, order and the blacklist. */
export function searchKey(state: SearchState): string {
  const params = [...state.params.entries()]
    .map(([k, v]) => `${k.toLowerCase()}=${v.trim().toLowerCase()}`)
    .sort();
  const groups = state.groups.map(groupKey).sort();
  return `${state.location.toLowerCase()}?${params.join('&')}#${groups.join('|')}`;
}

export function groupKey(g: SearchGroup): string {
  return [g.make, g.model ?? '', g.version ?? ''].map(nameKey).join('/');
}

function buildQuery(state: SearchState, opts: { includePaging: boolean; includeBlacklist: boolean }): URLSearchParams {
  const query = new URLSearchParams(state.params);
  state.groups.forEach((g, i) => {
    const n = i + 1;
    query.set(`marca${n}`, g.make);
    if (g.model) query.set(`modelo${n}`, g.model);
    if (g.model && g.version) query.set(`versao${n}`, g.version);
  });
  if (opts.includePaging) {
    if (state.order !== 1) query.set('o', String(state.order));
    query.set('page', String(state.page));
  }
  if (opts.includeBlacklist && !isBlacklistEmpty(state.blacklist)) encodeBlacklist(state.blacklist, query);
  return query;
}

/** Page URL in the site's own shape (path slugs for the first group). */
export function toPageUrl(state: SearchState): string {
  const segments = ['carros', state.location];
  const first = state.groups[0];
  if (first) {
    segments.push(slugify(first.make));
    if (first.model) {
      segments.push(slugify(first.model));
      if (first.version) segments.push(slugify(first.version));
    }
  }
  const query = buildQuery(state, { includePaging: true, includeBlacklist: true });
  return `/${segments.join('/')}?${query.toString()}`;
}

export interface ApiOptions {
  page: number;
  perPage: number;
  showMenu: boolean;
  order?: number;
}

/** `/api/search/car` URL; the API only reads `/carros/{location}` plus the query. */
export function toApiUrl(state: SearchState, opts: ApiOptions): string {
  const query = buildQuery(state, { includePaging: false, includeBlacklist: false });
  const pageUrl = `${WM_ORIGIN}/carros/${state.location}?${query.toString()}`;
  const api = new URLSearchParams({
    url: pageUrl,
    displayPerPage: String(opts.perPage),
    actualPage: String(opts.page),
    showMenu: String(opts.showMenu),
    showCount: 'true',
    showBreadCrumb: 'false',
    order: String(opts.order ?? state.order),
    mediaZeroKm: 'false',
  });
  return `${WM_ORIGIN}/api/search/car?${api.toString()}`;
}

export function withGroups(state: SearchState, groups: SearchGroup[]): SearchState {
  return { ...state, params: new URLSearchParams(state.params), groups, page: 1 };
}

export function withBlacklist(state: SearchState, blacklist: Blacklist): SearchState {
  return { ...state, params: new URLSearchParams(state.params), blacklist, page: 1 };
}

export function withPage(state: SearchState, page: number): SearchState {
  return { ...state, params: new URLSearchParams(state.params), page: Math.max(1, page) };
}

export type GroupChange =
  | { kind: 'unchanged'; state: SearchState }
  | { kind: 'changed'; state: SearchState }
  | { kind: 'limit' };

/**
 * Applies a tree click: keeps every other filter and the blacklist, adds the
 * clicked brand/model/version as narrowly as possible, and resets the page.
 */
export function applyTreeTarget(state: SearchState, target: TreeTarget): GroupChange {
  const same = (a?: string, b?: string) => (a ? nameKey(a) : '') === (b ? nameKey(b) : '');
  const groups = state.groups.map((g) => ({ ...g }));

  const exact = groups.find(
    (g) =>
      same(g.make, target.make) &&
      (!target.model || same(g.model, target.model)) &&
      (!target.version || same(g.version, target.version)),
  );
  if (exact) return { kind: 'unchanged', state };

  if (target.model) {
    // Narrow an existing broader group of the same brand (and model) in place.
    const broader =
      (target.version && groups.find((g) => same(g.make, target.make) && same(g.model, target.model) && !g.version)) ||
      groups.find((g) => same(g.make, target.make) && !g.model);
    if (broader) {
      broader.model = target.model;
      broader.version = target.version;
      return { kind: 'changed', state: withGroups(state, groups) };
    }
  }

  if (groups.length >= MAX_GROUPS) return { kind: 'limit' };
  groups.push({ make: target.make, model: target.model, version: target.model ? target.version : undefined });
  return { kind: 'changed', state: withGroups(state, groups) };
}

/** Whether the target is already part of the active filters (for highlighting). */
export function isTargetApplied(state: SearchState, target: TreeTarget): boolean {
  return applyTreeTarget(state, target).kind === 'unchanged';
}

/**
 * If `child` returns a subset of `parent`'s results (same filters, narrower
 * groups), returns a predicate selecting child listings from parent listings.
 */
export function narrowingPredicate(
  parent: SearchState,
  child: SearchState,
): ((l: { make: string; model: string; version: string }) => boolean) | null {
  if (parent.location.toLowerCase() !== child.location.toLowerCase()) return null;
  const paramsKey = (s: SearchState) =>
    [...s.params.entries()].map(([k, v]) => `${k.toLowerCase()}=${v.trim().toLowerCase()}`).sort().join('&');
  if (paramsKey(parent) !== paramsKey(child)) return null;
  if (child.groups.length === 0) return parent.groups.length === 0 ? () => true : null;

  const covers = (outer: SearchGroup, inner: SearchGroup) =>
    nameKey(outer.make) === nameKey(inner.make) &&
    (!outer.model || (!!inner.model && nameKey(outer.model) === nameKey(inner.model))) &&
    (!outer.version || (!!inner.version && nameKey(outer.version) === nameKey(inner.version)));

  if (parent.groups.length > 0 && !child.groups.every((cg) => parent.groups.some((pg) => covers(pg, cg)))) {
    return null;
  }
  const childGroups = child.groups.map((g) => ({
    make: nameKey(g.make),
    model: g.model ? nameKey(g.model) : undefined,
    version: g.version ? nameKey(g.version) : undefined,
  }));
  return (l) => {
    const make = nameKey(l.make);
    const model = nameKey(l.model);
    const version = nameKey(l.version);
    return childGroups.some(
      (g) => g.make === make && (!g.model || g.model === model) && (!g.version || g.version === version),
    );
  };
}
