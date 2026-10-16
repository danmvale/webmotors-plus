import Fuse from 'fuse.js';
import { vehicleName } from '../../lib/format';
import type { VehicleType } from '../../lib/webmotors/client';
import { nameKey, slugify } from '../../lib/webmotors/slug';
import { parseSearchUrl } from '../../lib/webmotors/search-url';
import type { AutocompleteBrand } from '../../lib/webmotors/types';

export interface Suggestion {
  kind: 'make' | 'model';
  make: string;
  model?: string;
  label: string;
  /** Name without spaces or punctuation, as people type it ("hrv", "tcross"). */
  alias?: string;
}

/** "HR-V" → "HRV", "Land Rover" → "LANDROVER". */
function compactKey(value: string): string {
  return nameKey(value).replace(/[^A-Z0-9]/g, '');
}

export interface RecentSearch {
  url: string;
  query: string;
}

/** Same fuzziness as the homepage bar (Fuse.js, threshold 0.26). */
export function buildIndex(brands: AutocompleteBrand[]): Fuse<Suggestion> {
  const entries: Suggestion[] = [];
  for (const brand of brands) {
    entries.push({ kind: 'make', make: brand.name, label: vehicleName(brand.name), alias: compactKey(brand.name) });
    for (const model of brand.items) {
      entries.push({
        kind: 'model',
        make: brand.name,
        model: model.name,
        label: `${vehicleName(brand.name)} ${vehicleName(model.name)}`,
        alias: compactKey(model.name),
      });
    }
  }
  return new Fuse(entries, {
    keys: [
      { name: 'label', weight: 2 },
      { name: 'model', weight: 1 },
      { name: 'alias', weight: 1 },
    ],
    threshold: 0.26,
    ignoreLocation: true,
    includeScore: true,
  });
}

export function suggest(index: Fuse<Suggestion> | undefined, query: string, limit = 5): Suggestion[] {
  const q = query.trim();
  if (!index || q.length < 2) return [];
  return index.search(q, { limit }).map((r) => r.item);
}

/** A query that *is* a brand, "brand model" or an unambiguous model name. */
export function exactMatch(brands: AutocompleteBrand[], query: string): Suggestion | undefined {
  // Spaces and punctuation are ignored: "hrv" = "HR-V", "honda civic" = "hondacivic".
  const q = compactKey(query);
  if (!q) return undefined;
  const modelHits: Suggestion[] = [];
  for (const brand of brands) {
    const make = compactKey(brand.name);
    if (q === make) return { kind: 'make', make: brand.name, label: vehicleName(brand.name) };
    for (const model of brand.items) {
      const m = compactKey(model.name);
      if (q === `${make}${m}`) return { kind: 'model', make: brand.name, model: model.name, label: `${vehicleName(brand.name)} ${vehicleName(model.name)}` };
      if (q === m) modelHits.push({ kind: 'model', make: brand.name, model: model.name, label: `${vehicleName(brand.name)} ${vehicleName(model.name)}` });
    }
  }
  return modelHits.length === 1 ? modelHits[0] : undefined;
}

export function vehicleTypeFor(pathname: string): VehicleType {
  return /^\/motos(\/|$)/.test(pathname) ? 'bike' : 'car';
}

/**
 * Results URL for a brand/model, in the site's own format. Keeps the current
 * search's location when the user is already on a results page.
 */
export function suggestionUrl(s: Suggestion, query: string, current: URL): string {
  let location = 'estoque';
  let estadocidade: string | null = null;
  if (current.pathname.startsWith('/carros/')) {
    const state = parseSearchUrl(current);
    location = state.location;
    estadocidade = state.params.get('estadocidade');
  }
  const segments = ['carros', location, slugify(s.make)];
  if (s.model) segments.push(slugify(s.model));
  const params = new URLSearchParams({ tipoveiculo: 'carros' });
  if (estadocidade) params.set('estadocidade', estadocidade);
  params.set('marca1', s.make);
  if (s.model) params.set('modelo1', s.model);
  params.set('autocomplete', query.trim() || s.label);
  params.set('autocompleteTerm', s.label);
  return `/${segments.join('/')}?${params.toString()}`;
}

/** Shared with the site's homepage bar (same key and shape). */
function recentKey(vehicle: VehicleType): string {
  return vehicle === 'bike' ? 'motos_lastAISearches' : 'carros_lastAISearches';
}

export function readRecent(vehicle: VehicleType): RecentSearch[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentKey(vehicle)) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((r): r is RecentSearch => typeof r?.url === 'string' && typeof r?.query === 'string').slice(0, 3)
      : [];
  } catch {
    return [];
  }
}

export function saveRecent(vehicle: VehicleType, entry: RecentSearch): void {
  try {
    const list = [entry, ...readRecent(vehicle).filter((r) => nameKey(r.query) !== nameKey(entry.query))].slice(0, 3);
    localStorage.setItem(recentKey(vehicle), JSON.stringify(list));
  } catch {
    // Storage unavailable: recent searches are a convenience only.
  }
}

export const EXAMPLE_PHRASES = [
  'SUV automático até R$ 100 mil',
  'hatch econômico para a cidade',
  'picape diesel 4x4',
  'sedã com teto solar a partir de 2020',
  'carro de 7 lugares em São Paulo',
  'Corolla híbrido até 80 mil km',
];
