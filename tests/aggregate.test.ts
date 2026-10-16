import { describe, expect, it } from 'vitest';
import { addModel, createExclusionTest, EMPTY_BLACKLIST } from '../src/features/blacklist/blacklist';
import { impliedFipe, median } from '../src/features/fipe/implied';
import { aggregate } from '../src/features/tree/aggregate';
import { adUrl, photoUrl, toListingLite } from '../src/lib/webmotors/listing';
import { rawListing } from './fixtures/search';

const listings = [
  rawListing({ version: '2.0 16V FLEXONE EXL 4P CVT', year: 2020, price: 114500, fipePercent: 97 }),
  rawListing({ version: '2.0 16V FLEXONE EXL 4P CVT', year: 2020, price: 120900, fipePercent: 102 }),
  rawListing({ version: '2.0 16V FLEXONE EXL 4P CVT', year: 2020, price: 117000 }),
  rawListing({ version: '2.0 16V FLEXONE EX 4P CVT', year: 2020, price: 105000, fipePercent: 99 }),
  rawListing({ version: '2.0 16V FLEXONE EX 4P CVT', year: 2019, price: 99000 }),
  rawListing({ model: 'FIT', version: '1.5 EXL 16V FLEX 4P AUTOMÁTICO', year: 2019, price: 80000 }),
  rawListing({ make: 'TOYOTA', model: 'COROLLA', version: '2.0 XEI', year: 2021, price: 130000 }),
].map((r) => toListingLite(r)!);

describe('aggregate', () => {
  const tree = aggregate(listings);

  it('groups Marca → Modelo → Ano → Versão, most offers first', () => {
    expect(tree.map((m) => [m.name, m.count])).toEqual([
      ['HONDA', 6],
      ['TOYOTA', 1],
    ]);
    const civic = tree[0]!.models[0]!;
    expect([civic.name, civic.count]).toEqual(['CIVIC', 5]);
    expect(civic.years.map((y) => y.year)).toEqual([2020, 2019]);
    expect(civic.years[0]!.versions.map((v) => [v.name, v.count])).toEqual([
      ['2.0 16V FLEXONE EXL 4P CVT', 3],
      ['2.0 16V FLEXONE EX 4P CVT', 1],
    ]);
  });

  it('computes the mean asking price and the implied FIPE', () => {
    const exl = tree[0]!.models[0]!.years[0]!.versions[0]!;
    expect(exl.avgPrice).toBe(Math.round((114500 + 120900 + 117000) / 3));
    expect(exl.impliedSamples).toBe(2);
    expect(exl.implied).toBe(Math.round(((100 * 114500) / 97 + (100 * 120900) / 102) / 2));
    expect(exl.attrs).toMatchObject({ engine: '2.0', transmission: 'Automática', doors: '4' });
  });

  it('applies the blacklist', () => {
    const filtered = aggregate(listings, createExclusionTest(addModel(EMPTY_BLACKLIST, 'HONDA', 'CIVIC')));
    expect(filtered.map((m) => [m.name, m.count])).toEqual([
      ['HONDA', 1],
      ['TOYOTA', 1],
    ]);
  });
});

describe('implied FIPE', () => {
  it('uses the median, robust to outliers', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 100])).toBe(2.5);
    expect(impliedFipe([])).toBeUndefined();
  });
});

describe('listing helpers', () => {
  const l = toListingLite(
    rawListing({ id: 81167830, make: 'HONDA', model: 'CIVIC', version: '2.0 DI e:HEV ADVANCED E-CVT', year: 2024 }),
  )!;

  it('builds the site ad URL', () => {
    expect(adUrl(l)).toBe('/comprar/honda/civic/20-di-ehev-advanced-e-cvt/4-portas/2024/81167830');
    expect(adUrl({ ...l, yearFab: 2023 })).toBe('/comprar/honda/civic/20-di-ehev-advanced-e-cvt/4-portas/2023-2024/81167830');
  });

  it('builds the photo URL', () => {
    expect(photoUrl(l.photo)).toBe(
      'https://image.webmotors.com.br/_fotos/anunciousados/gigante/2026/202610/20261015/honda-civic-wmimagem01.jpg?s=fill&w=242&h=190&q=70&type=webp',
    );
  });

  it('maps seller state to UF and skips sponsored zero-km slots', () => {
    expect(l.uf).toBe('SP');
    expect(toListingLite({ ...rawListing({}), UniqueId: 0 })).toBeNull();
  });
});

describe('brand order', () => {
  it('lists brands A–Z regardless of how many listings they have', () => {
    const listings = [
      ...['VOLKSWAGEN', 'VOLKSWAGEN', 'VOLKSWAGEN', 'CITROËN', 'CHEVROLET', 'CHEVROLET', 'AUDI'].map((make) =>
        toListingLite(rawListing({ make, model: 'X' }))!,
      ),
    ];
    expect(aggregate(listings).map((m) => m.name)).toEqual(['AUDI', 'CHEVROLET', 'CITROËN', 'VOLKSWAGEN']);
  });
});
