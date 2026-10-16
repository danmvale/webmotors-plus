import { BLACKLIST_PARAMS } from '../../lib/config';
import { nameKey } from '../../lib/webmotors/slug';

export interface BlacklistedModel {
  make: string;
  model: string;
}

export interface Blacklist {
  makes: string[];
  models: BlacklistedModel[];
}

export const EMPTY_BLACKLIST: Blacklist = Object.freeze({ makes: [], models: [] }) as Blacklist;

const LIST_SEP = '|';
const MODEL_SEP = ':';

export function isBlacklistEmpty(bl: Blacklist): boolean {
  return bl.makes.length === 0 && bl.models.length === 0;
}

export function blacklistSize(bl: Blacklist): number {
  return bl.makes.length + bl.models.length;
}

/** `excluir_marcas=FIAT|CHEVROLET&excluir_modelos=HONDA:FIT|VOLKSWAGEN:GOL` */
export function decodeBlacklist(params: URLSearchParams): Blacklist {
  const makes = uniq(splitList(params.get(BLACKLIST_PARAMS.makes)).map(normalizeName));
  const makeSet = new Set(makes);
  const models: BlacklistedModel[] = [];
  const seen = new Set<string>();
  for (const entry of splitList(params.get(BLACKLIST_PARAMS.models))) {
    const at = entry.indexOf(MODEL_SEP);
    if (at <= 0) continue;
    const make = normalizeName(entry.slice(0, at));
    const model = normalizeName(entry.slice(at + 1));
    const key = modelKey(make, model);
    if (!model || makeSet.has(make) || seen.has(key)) continue;
    seen.add(key);
    models.push({ make, model });
  }
  return { makes, models };
}

export function encodeBlacklist(bl: Blacklist, params: URLSearchParams): void {
  params.delete(BLACKLIST_PARAMS.makes);
  params.delete(BLACKLIST_PARAMS.models);
  if (bl.makes.length) params.set(BLACKLIST_PARAMS.makes, bl.makes.join(LIST_SEP));
  if (bl.models.length) {
    params.set(BLACKLIST_PARAMS.models, bl.models.map((m) => `${m.make}${MODEL_SEP}${m.model}`).join(LIST_SEP));
  }
}

export function addMake(bl: Blacklist, make: string): Blacklist {
  const name = normalizeName(make);
  if (!name || bl.makes.includes(name)) return bl;
  // A blacklisted brand makes its blacklisted models redundant.
  return { makes: [...bl.makes, name], models: bl.models.filter((m) => m.make !== name) };
}

export function addModel(bl: Blacklist, make: string, model: string): Blacklist {
  const m = { make: normalizeName(make), model: normalizeName(model) };
  if (!m.make || !m.model || bl.makes.includes(m.make)) return bl;
  if (bl.models.some((x) => x.make === m.make && x.model === m.model)) return bl;
  return { makes: bl.makes, models: [...bl.models, m] };
}

export function removeMake(bl: Blacklist, make: string): Blacklist {
  const name = normalizeName(make);
  return { makes: bl.makes.filter((x) => x !== name), models: bl.models };
}

export function removeModel(bl: Blacklist, make: string, model: string): Blacklist {
  const key = modelKey(normalizeName(make), normalizeName(model));
  return { makes: bl.makes, models: bl.models.filter((m) => modelKey(m.make, m.model) !== key) };
}

/**
 * The latest choice wins: drops blacklist entries the search now asks for
 * explicitly (a brand picked in the site's Marca filter, or a model under it).
 * A blacklisted model of a selected brand still applies ("Honda minus Fit").
 */
export function withoutSelected(bl: Blacklist, groups: ReadonlyArray<{ make: string; model?: string }>): Blacklist {
  if (isBlacklistEmpty(bl) || !groups.length) return bl;
  const makes = new Set(groups.map((g) => nameKey(g.make)));
  const models = new Set(groups.filter((g) => g.model).map((g) => modelKey(nameKey(g.make), nameKey(g.model!))));
  const next = {
    makes: bl.makes.filter((m) => !makes.has(nameKey(m))),
    models: bl.models.filter((m) => !models.has(modelKey(nameKey(m.make), nameKey(m.model)))),
  };
  return next.makes.length === bl.makes.length && next.models.length === bl.models.length ? bl : next;
}

export type ExclusionTest = (make: string, model: string) => boolean;

export function createExclusionTest(bl: Blacklist): ExclusionTest {
  if (isBlacklistEmpty(bl)) return () => false;
  const makes = new Set(bl.makes.map(nameKey));
  const models = new Set(bl.models.map((m) => modelKey(nameKey(m.make), nameKey(m.model))));
  return (make, model) => makes.has(nameKey(make)) || models.has(modelKey(nameKey(make), nameKey(model)));
}

export function sameBlacklist(a: Blacklist, b: Blacklist): boolean {
  const key = (bl: Blacklist) =>
    [...bl.makes].sort().join(LIST_SEP) + '#' + bl.models.map((m) => modelKey(m.make, m.model)).sort().join(LIST_SEP);
  return key(a) === key(b);
}

function modelKey(make: string, model: string): string {
  return `${make}${MODEL_SEP}${model}`;
}

function normalizeName(value: string): string {
  return value.replace(/[|:]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

function splitList(value: string | null): string[] {
  return value ? value.split(LIST_SEP).map((s) => s.trim()).filter(Boolean) : [];
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}
