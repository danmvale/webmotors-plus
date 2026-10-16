import { sleep } from '../../lib/webmotors/scheduler';
import { nameKey } from '../../lib/webmotors/slug';
import {
  FIPE_CANDIDATES_TO_PRICE,
  FIPE_CONCURRENCY,
  FIPE_MAPPING_VERSION,
  FIPE_SPACING_MS,
  FIPE_VALIDATION_TOLERANCE,
} from '../../lib/config';
import type { PersistentCache } from './cache';
import { FipeHttpError, type FipePrice, type FipeReference, type FipeSource } from './fipe-api';
import { isConfidentWithoutPrice, labelStartsWithModel, rankCandidates, type ScoredCandidate } from './matcher';
import { extractFeatures, findBrandCode, type FuelCode, fuelCandidates, tokenize } from './normalize';
import type { FipeQuery, FipeResult } from './types';

const DAY = 24 * 60 * 60 * 1000;
const ZERO_KM_YEAR = 32000;

/** Runs at most `concurrency` tasks at once, starting them `spacingMs` apart. */
export class Limiter {
  private active = 0;
  private lastStart = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly spacingMs: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      const wait = this.lastStart + this.spacingMs - Date.now();
      this.lastStart = Math.max(Date.now(), this.lastStart + this.spacingMs);
      await sleep(wait);
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

interface Mapping {
  brand: string;
  model: string;
  year: number;
  fuel: FuelCode;
  /** Picked as FIPE's only version of the model, not by name. */
  approximate?: boolean;
}

type SourcedPrice = FipePrice & { source: FipeSource['name'] };

export class FipeResolver {
  private readonly limiter = new Limiter(FIPE_CONCURRENCY, FIPE_SPACING_MS);

  constructor(
    private readonly primary: FipeSource,
    private readonly fallback: FipeSource & { remaining: number },
    private readonly cache: PersistentCache,
  ) {}

  /** Current FIPE reference month, cached for 12 h. */
  reference(): Promise<FipeReference> {
    return this.cache.getOrCompute('ref', 12 * 60 * 60 * 1000, () => this.call((s) => s.reference()));
  }

  /** Called by a daily alarm: when FIPE publishes a new month, old prices are dropped. */
  async refreshReference(): Promise<void> {
    const current = await this.cache.get<FipeReference>('ref');
    const fresh = await this.call((s) => s.reference());
    await this.cache.set('ref', fresh, 12 * 60 * 60 * 1000);
    if (current && current.code !== fresh.code) await this.cache.prune(['ref', 'map:', `${fresh.code}:`]);
  }

  async resolve(query: FipeQuery): Promise<FipeResult | null> {
    const ref = await this.reference();
    const id = [query.make, query.model, query.version].map(nameKey).join('|') + `|${query.year}|${query.zeroKm ? 1 : 0}`;
    const resultKey = `${ref.code}:res:v${FIPE_MAPPING_VERSION}:${id}|${query.implied ? Math.round(query.implied / 500) : 'x'}`;
    const cached = await this.cache.get<FipeResult | { none: true }>(resultKey);
    if (cached) return 'none' in cached ? null : cached;

    const result = await this.compute(query, ref, `map:v${FIPE_MAPPING_VERSION}:${id}`);
    await this.cache.set(resultKey, result ?? { none: true }, result ? 35 * DAY : 2 * DAY);
    return result;
  }

  private async compute(q: FipeQuery, ref: FipeReference, mapKey: string): Promise<FipeResult | null> {
    // 1. A mapping found in a previous month only needs this month's price.
    const known = await this.cache.get<Mapping>(mapKey);
    if (known) {
      const price = await this.price(ref.code, known);
      if (price && (!q.implied || withinTolerance(price.value, q))) {
        return this.toResult(price, q.implied ? 'validated' : known.approximate ? 'approximate' : 'matched');
      }
    }

    const brands = await this.cache.getOrCompute(`${ref.code}:brands`, 35 * DAY, () =>
      this.call((s) => s.brands(ref.code)),
    );
    const brand = findBrandCode(q.make, brands);
    if (!brand) return null;

    const features = extractFeatures(q.version, q.attrs);
    const years = q.zeroKm ? [ZERO_KM_YEAR, q.year] : q.year >= new Date().getFullYear() ? [q.year, ZERO_KM_YEAR] : [q.year];
    const lists: Array<{ year: number; fuel: FuelCode; candidates: Array<{ code: string; label: string }> }> = [];

    for (const year of years) {
      for (const fuel of fuelCandidates(features)) {
        const candidates = await this.cache.getOrCompute(`${ref.code}:models:${brand}:${year}-${fuel}`, 35 * DAY, () =>
          this.call((s) => s.modelsByYear(ref.code, brand, year, fuel)),
        );
        if (!candidates.length) continue;
        lists.push({ year, fuel, candidates });
        const sameModel = candidates.filter((c) => labelStartsWithModel(tokenize(c.label), q.model) > 0);
        if (!sameModel.length) continue;
        const picked = await this.pick(rankCandidates(q, sameModel), q, ref, brand, year, fuel, {
          onlyVersion: sameModel.length === 1,
        });
        if (picked) {
          await this.cache.set(mapKey, picked.mapping, 180 * DAY);
          return picked.result;
        }
        // The right model exists for this fuel but no trim matched: other fuels won't help.
        if (features.fuel) return null;
      }
    }

    // Model naming differs between Webmotors and FIPE: only accept a price-validated match.
    if (!q.implied) return null;
    for (const { year, fuel, candidates } of lists.slice(0, 2)) {
      const picked = await this.pick(rankCandidates(q, candidates), q, ref, brand, year, fuel, { requireValidation: true });
      if (picked) {
        await this.cache.set(mapKey, picked.mapping, 180 * DAY);
        return picked.result;
      }
    }
    return null;
  }

  private async pick(
    ranked: ScoredCandidate[],
    q: FipeQuery,
    ref: FipeReference,
    brand: string,
    year: number,
    fuel: FuelCode,
    { requireValidation = false, onlyVersion = false }: { requireValidation?: boolean; onlyVersion?: boolean } = {},
  ): Promise<{ result: FipeResult; mapping: Mapping } | null> {
    if (!ranked.length) return null;

    if (q.implied) {
      let best: { price: SourcedPrice; mapping: Mapping; rank: number } | undefined;
      for (const candidate of ranked.slice(0, FIPE_CANDIDATES_TO_PRICE)) {
        const mapping = { brand, model: candidate.code, year, fuel };
        const price = await this.price(ref.code, mapping);
        if (!price || !withinTolerance(price.value, q)) continue;
        const rank = candidate.score - 2 * Math.abs(price.value - q.implied) / q.implied;
        if (!best || rank > best.rank) best = { price, mapping, rank };
      }
      return best ? { result: this.toResult(best.price, 'validated'), mapping: best.mapping } : null;
    }

    if (requireValidation) return null;
    // When FIPE lists a single version of the model for this year and fuel (and it
    // has no technical conflict), it is the same car under another trim name
    // (e.g. "Advanced" vs "Touring").
    const approximate = !isConfidentWithoutPrice(ranked);
    if (approximate && !(onlyVersion && ranked.length === 1)) return null;
    const mapping: Mapping = { brand, model: ranked[0]!.code, year, fuel, ...(approximate ? { approximate } : {}) };
    const price = await this.price(ref.code, mapping);
    return price ? { result: this.toResult(price, approximate ? 'approximate' : 'matched'), mapping } : null;
  }

  private price(ref: string, m: Mapping): Promise<SourcedPrice | null> {
    return this.cache.getOrCompute(`${ref}:price:${m.brand}:${m.model}:${m.year}-${m.fuel}`, 35 * DAY, async () => {
      const { value, source } = await this.callWithSource((s) => s.price(ref, m.brand, m.model, m.year, m.fuel));
      return value ? { ...value, source } : null;
    });
  }

  private toResult(price: SourcedPrice, confidence: FipeResult['confidence']): FipeResult {
    return { ...price, confidence };
  }

  private async call<T>(fn: (source: FipeSource) => Promise<T>): Promise<T> {
    return (await this.callWithSource(fn)).value;
  }

  /** Primary source with retries; falls back to parallelum while it has quota. */
  private async callWithSource<T>(fn: (source: FipeSource) => Promise<T>): Promise<{ value: T; source: FipeSource['name'] }> {
    try {
      const value = await this.withRetry(() => this.limiter.run(() => fn(this.primary)));
      return { value, source: this.primary.name };
    } catch (error) {
      if (this.fallback.remaining <= 20) throw error;
      const value = await this.withRetry(() => this.limiter.run(() => fn(this.fallback)));
      return { value, source: this.fallback.name };
    }
  }

  private async withRetry<T>(task: () => Promise<T>, attempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await task();
      } catch (error) {
        const retriable = !(error instanceof FipeHttpError) || error.status === 429 || error.status >= 500;
        if (!retriable || attempt >= attempts) throw error;
        await sleep(400 * 2 ** attempt + Math.random() * 300);
      }
    }
  }
}

function withinTolerance(value: number, q: FipeQuery): boolean {
  if (!q.implied) return false;
  const tolerance = FIPE_VALIDATION_TOLERANCE * (q.impliedSamples <= 2 ? 1.5 : 1);
  return Math.abs(value - q.implied) / q.implied <= tolerance;
}
