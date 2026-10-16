import type { FacetItem, RawListing, SearchResponse } from '../../src/lib/webmotors/types';

/** Real counts observed on 2026-10-15 for São Paulo (trimmed to a few brands). */
const HONDA_MODELS: FacetItem[] = [
  { name: 'HR-V', count: 4121 },
  { name: 'CITY', count: 2174 },
  { name: 'CIVIC', count: 1975 },
  { name: 'FIT', count: 1402 },
  { name: 'CRV', count: 440 },
];

const CIVIC_VERSIONS: FacetItem[] = [
  { name: '2.0 16V FLEXONE EXL 4P CVT', count: 403 },
  { name: '2.0 LXR 16V FLEX 4P AUTOMÁTICO', count: 334 },
  { name: '2.0 16V FLEXONE EX 4P CVT', count: 270 },
  { name: '1.5 16V TURBO GASOLINA TOURING 4P CVT', count: 172 },
];

export function makeFacetResponse(opts: { selectHonda?: boolean; selectCivic?: boolean; count: number }): SearchResponse {
  const honda: FacetItem = { name: 'HONDA', count: 10833, selected: opts.selectHonda || null };
  if (opts.selectHonda) {
    honda.items = HONDA_MODELS.map((m) =>
      m.name === 'CIVIC' && opts.selectCivic ? { ...m, selected: true, items: CIVIC_VERSIONS } : { ...m },
    );
  }
  return {
    Count: opts.count,
    SearchResults: [],
    Filters: [
      {
        name: 'Make',
        items: [
          honda,
          { name: 'VOLKSWAGEN', count: 28487 },
          { name: 'FIAT', count: 20432 },
          { name: 'CHEVROLET', count: 18977 },
        ],
      },
    ],
  };
}

let nextId = 1;

export function rawListing(overrides: {
  make?: string;
  model?: string;
  version?: string;
  year?: number;
  yearFab?: number;
  price?: number;
  fipePercent?: number;
  zeroKm?: boolean;
  id?: number;
}): RawListing {
  const year = overrides.year ?? 2020;
  return {
    UniqueId: overrides.id ?? nextId++,
    PhotoPath: '2026\\202610\\20261015\\honda-civic-wmimagem01.jpg',
    Specification: {
      Title: 'HONDA CIVIC 2.0 16V FLEXONE EXL 4P CVT',
      Make: { id: 16, Value: overrides.make ?? 'HONDA' },
      Model: { id: 690, Value: overrides.model ?? 'CIVIC' },
      Version: { id: 1, Value: overrides.version ?? '2.0 16V FLEXONE EXL 4P CVT' },
      YearFabrication: String(overrides.yearFab ?? year),
      YearModel: year,
      Odometer: 36905,
      Transmission: 'Automática',
      NumberPorts: '4',
      BodyType: 'Sedã',
      EngineSize: '2.0',
      HorsePower: '155 cv',
    },
    Seller: { City: 'Mogi das Cruzes', State: 'São Paulo (SP)' },
    Prices: { Price: overrides.price ?? 114500, SearchPrice: overrides.price ?? 114500, FinancingStartValue: 2100 },
    FipePercent: overrides.fipePercent,
    HotDeal: [],
    ListingType: overrides.zeroKm ? 'N' : 'U',
    MediaZeroKm: false,
  };
}
