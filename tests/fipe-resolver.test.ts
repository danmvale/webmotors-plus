import { describe, expect, it } from 'vitest';
import { PersistentCache } from '../src/features/fipe/cache';
import type { FipeSource } from '../src/features/fipe/fipe-api';
import { FipeResolver } from '../src/features/fipe/resolver';
import type { FipeCandidate, FipeQuery } from '../src/features/fipe/types';

function source(models: Record<string, FipeCandidate[]>, prices: Record<string, number>): FipeSource & { remaining: number } {
  return {
    name: 'fipe',
    remaining: 0,
    reference: async () => ({ code: '338', month: 'outubro de 2026' }),
    brands: async () => [{ code: '25', name: 'Honda' }],
    modelsByYear: async (_ref, _brand, year, fuel) => models[`${year}-${fuel}`] ?? [],
    price: async (_ref, _brand, model) =>
      prices[model] ? { value: prices[model]!, code: `fipe-${model}`, label: `label-${model}`, month: 'outubro de 2026' } : null,
  };
}

const query = (version: string, extra: Partial<FipeQuery> = {}): FipeQuery => ({
  make: 'HONDA',
  model: 'CIVIC',
  version,
  year: 2025,
  zeroKm: false,
  impliedSamples: 0,
  attrs: { engine: '2.0' },
  ...extra,
});

describe('FipeResolver', () => {
  const models = {
    '2025-6': [{ code: '10366', label: 'Civic Sed.Touring 2.0 16V Aut. (Híbrido)' }],
    '2025-1': [
      { code: '10727', label: 'Civic Type-R 2.0 Turbo 16V' },
      { code: '10800', label: 'Civic Sedan Sport 2.0 16V Aut.' },
    ],
  };
  const prices = { '10366': 216_350, '10727': 393_723, '10800': 180_000 };

  it("uses FIPE's only version of a model as an approximate value", async () => {
    const resolver = new FipeResolver(source(models, prices), source({}, {}), new PersistentCache('t1:'));
    const result = await resolver.resolve(query('2.0 DI e:HEV ADVANCED E-CVT'));
    expect(result).toMatchObject({ value: 216_350, confidence: 'approximate' });
  });

  it('does not guess between several versions without a clear name match', async () => {
    const resolver = new FipeResolver(source(models, prices), source({}, {}), new PersistentCache('t2:'));
    expect(await resolver.resolve(query('2.0 16V GASOLINA LX MANUAL'))).toBeNull();
  });

  it('validates against the Webmotors FIPE percentage when available', async () => {
    const resolver = new FipeResolver(source(models, prices), source({}, {}), new PersistentCache('t3:'));
    const result = await resolver.resolve(
      query('2.0 DI e:HEV ADVANCED E-CVT', { implied: 215_000, impliedSamples: 5 }),
    );
    expect(result).toMatchObject({ value: 216_350, confidence: 'validated' });
    const off = await resolver.resolve(query('2.0 DI e:HEV ADVANCED E-CVT', { implied: 150_000, impliedSamples: 5 }));
    expect(off).toBeNull();
  });
});
