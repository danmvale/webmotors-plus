import { nameKey } from '../../lib/webmotors/slug';
import type { ListingLite } from '../../lib/webmotors/types';
import type { ExclusionTest } from '../blacklist/blacklist';
import { impliedFipe, impliedFipeSample } from '../fipe/implied';
import type { VersionAttrs } from '../fipe/types';

export interface VersionAgg {
  name: string;
  count: number;
  avgPrice?: number;
  implied?: number;
  impliedSamples: number;
  zeroKm: boolean;
  attrs: VersionAttrs;
}

export interface YearAgg {
  year: number;
  count: number;
  versions: VersionAgg[];
}

export interface ModelAgg {
  name: string;
  count: number;
  years: YearAgg[];
}

/** Brands are listed A–Z (accent-insensitive, as in Portuguese). */
export const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });

export interface MakeAgg {
  name: string;
  count: number;
  models: ModelAgg[];
}

interface VersionAcc {
  name: string;
  count: number;
  priceSum: number;
  priceN: number;
  samples: number[];
  zeroKm: number;
  attrs: Record<keyof VersionAttrs, Map<string, number>>;
}

const ATTR_KEYS: Array<keyof VersionAttrs> = ['engine', 'hp', 'transmission', 'doors', 'traction', 'body'];

function newVersion(name: string): VersionAcc {
  return {
    name,
    count: 0,
    priceSum: 0,
    priceN: 0,
    samples: [],
    zeroKm: 0,
    attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, new Map()])) as VersionAcc['attrs'],
  };
}

function mostCommon(counts: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestN = 0;
  for (const [value, n] of counts) if (n > bestN) [best, bestN] = [value, n];
  return best;
}

/**
 * Builds Marca → Modelo → Ano → Versão with counts, mean asking price and the
 * FIPE value implied by Webmotors' `FipePercent`. Sorted by offer count
 * (years newest first).
 */
export function aggregate(listings: Iterable<ListingLite>, isExcluded: ExclusionTest = () => false): MakeAgg[] {
  type YearAcc = { year: number; count: number; versions: Map<string, VersionAcc> };
  type ModelAcc = { name: string; count: number; years: Map<number, YearAcc> };
  type MakeAcc = { name: string; count: number; models: Map<string, ModelAcc> };
  const makes = new Map<string, MakeAcc>();

  for (const l of listings) {
    if (isExcluded(l.make, l.model)) continue;
    const makeKey = nameKey(l.make);
    let make = makes.get(makeKey);
    if (!make) makes.set(makeKey, (make = { name: l.make, count: 0, models: new Map() }));
    make.count++;

    const modelKey = nameKey(l.model);
    let model = make.models.get(modelKey);
    if (!model) make.models.set(modelKey, (model = { name: l.model, count: 0, years: new Map() }));
    model.count++;

    let year = model.years.get(l.yearModel);
    if (!year) model.years.set(l.yearModel, (year = { year: l.yearModel, count: 0, versions: new Map() }));
    year.count++;

    const versionKey = nameKey(l.version);
    let version = year.versions.get(versionKey);
    if (!version) year.versions.set(versionKey, (version = newVersion(l.version)));
    version.count++;
    if (l.price > 0) {
      version.priceSum += l.price;
      version.priceN++;
    }
    const sample = impliedFipeSample(l.price, l.fipePercent);
    if (sample) version.samples.push(sample);
    if (l.zeroKm) version.zeroKm++;
    for (const key of ATTR_KEYS) {
      const value = l[key];
      if (value) version.attrs[key].set(value, (version.attrs[key].get(value) ?? 0) + 1);
    }
  }

  const byCount = <T extends { count: number; name: string }>(a: T, b: T) =>
    b.count - a.count || a.name.localeCompare(b.name, 'pt-BR');

  return [...makes.values()]
    .map((make) => ({
      name: make.name,
      count: make.count,
      models: [...make.models.values()]
        .map((model) => ({
          name: model.name,
          count: model.count,
          years: [...model.years.values()]
            .sort((a, b) => b.year - a.year)
            .map((year) => ({
              year: year.year,
              count: year.count,
              versions: [...year.versions.values()].map(finishVersion).sort(byCount),
            })),
        }))
        .sort(byCount),
    }))
    .sort(byName);
}

function finishVersion(v: VersionAcc): VersionAgg {
  const attrs: VersionAttrs = {};
  for (const key of ATTR_KEYS) {
    const value = mostCommon(v.attrs[key]);
    if (value) attrs[key] = value;
  }
  return {
    name: v.name,
    count: v.count,
    avgPrice: v.priceN ? Math.round(v.priceSum / v.priceN) : undefined,
    implied: impliedFipe(v.samples),
    impliedSamples: v.samples.length,
    zeroKm: v.zeroKm > v.count / 2,
    attrs,
  };
}
