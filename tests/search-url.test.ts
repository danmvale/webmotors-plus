import { describe, expect, it } from 'vitest';
import { addMake, addModel, EMPTY_BLACKLIST } from '../src/features/blacklist/blacklist';
import { slugify } from '../src/lib/webmotors/slug';
import {
  applyTreeTarget,
  isTargetApplied,
  narrowingPredicate,
  parseSearchUrl,
  searchKey,
  toApiUrl,
  toPageUrl,
  withBlacklist,
} from '../src/lib/webmotors/search-url';

const CIVIC_SP =
  'https://www.webmotors.com.br/carros/sp/honda/civic?tipoveiculo=carros&estadocidade=S%C3%A3o%20Paulo&marca1=HONDA&modelo1=CIVIC&page=2&o=5';

describe('slugify', () => {
  it.each([
    ['1.5 16V TURBO GASOLINA TOURING 4P CVT', '15-16v-turbo-gasolina-touring-4p-cvt'],
    ['2.0 DI e:HEV ADVANCED E-CVT', '20-di-ehev-advanced-e-cvt'],
    ['1.8 GLI 16V FLEX 4P AUTOMÁTICO', '18-gli-16v-flex-4p-automatico'],
    ['LAND ROVER', 'land-rover'],
    ['T-CROSS', 't-cross'],
  ])('%s → %s', (input, expected) => expect(slugify(input)).toBe(expected));
});

describe('parseSearchUrl', () => {
  it('reads location, groups, paging and keeps other params', () => {
    const s = parseSearchUrl(CIVIC_SP);
    expect(s.location).toBe('sp');
    expect(s.groups).toEqual([{ make: 'HONDA', model: 'CIVIC', version: undefined }]);
    expect(s.page).toBe(2);
    expect(s.order).toBe(5);
    expect(s.params.get('estadocidade')).toBe('São Paulo');
    expect(s.params.has('marca1')).toBe(false);
    expect(s.blacklist).toEqual(EMPTY_BLACKLIST);
  });

  it('reads the blacklist params', () => {
    const s = parseSearchUrl(`${CIVIC_SP}&excluir_marcas=FIAT|chevrolet&excluir_modelos=HONDA:FIT|VOLKSWAGEN:GOL`);
    expect(s.blacklist.makes).toEqual(['FIAT', 'CHEVROLET']);
    expect(s.blacklist.models).toEqual([
      { make: 'HONDA', model: 'FIT' },
      { make: 'VOLKSWAGEN', model: 'GOL' },
    ]);
  });

  it('ignores a version without a model', () => {
    const s = parseSearchUrl('/carros/estoque?marca1=HONDA&versao1=EXL');
    expect(s.groups).toEqual([{ make: 'HONDA', model: undefined, version: undefined }]);
  });
});

describe('searchKey', () => {
  it('ignores page, order, blacklist, case and param order', () => {
    const a = parseSearchUrl(CIVIC_SP);
    const b = parseSearchUrl(
      'https://www.webmotors.com.br/carros/sp?modelo1=civic&marca1=honda&estadocidade=S%C3%A3o%20Paulo&tipoveiculo=carros&excluir_marcas=FIAT',
    );
    expect(searchKey(a)).toBe(searchKey(b));
  });

  it('differs when filters differ', () => {
    const a = parseSearchUrl(CIVIC_SP);
    expect(searchKey(a)).not.toBe(searchKey(parseSearchUrl(`${CIVIC_SP}&anode=2020`)));
  });
});

describe('toPageUrl / toApiUrl', () => {
  it('round-trips a page URL with the blacklist', () => {
    const s = withBlacklist(parseSearchUrl(CIVIC_SP), addModel(addMake(EMPTY_BLACKLIST, 'fiat'), 'VOLKSWAGEN', 'GOL'));
    const url = toPageUrl(s);
    expect(url.startsWith('/carros/sp/honda/civic?')).toBe(true);
    const back = parseSearchUrl(url);
    expect(back.blacklist).toEqual(s.blacklist);
    expect(back.page).toBe(1);
    expect(back.order).toBe(5);
    expect(searchKey(back)).toBe(searchKey(s));
  });

  it('never sends our params to the API', () => {
    const s = parseSearchUrl(`${CIVIC_SP}&excluir_marcas=FIAT`);
    const api = new URL(toApiUrl(s, { page: 3, perPage: 500, showMenu: false }));
    expect(api.pathname).toBe('/api/search/car');
    expect(api.searchParams.get('actualPage')).toBe('3');
    expect(api.searchParams.get('displayPerPage')).toBe('500');
    expect(api.searchParams.get('order')).toBe('5');
    expect(api.searchParams.get('mediaZeroKm')).toBe('false');
    const page = new URL(api.searchParams.get('url')!);
    expect(page.pathname).toBe('/carros/sp');
    expect(page.searchParams.get('marca1')).toBe('HONDA');
    expect(page.searchParams.has('excluir_marcas')).toBe(false);
    expect(page.searchParams.has('page')).toBe(false);
  });
});

describe('applyTreeTarget', () => {
  const none = parseSearchUrl('/carros/sp?tipoveiculo=carros&anode=2018');
  const honda = parseSearchUrl('/carros/sp?marca1=HONDA&anode=2018&page=4');
  const civic = parseSearchUrl('/carros/sp?marca1=HONDA&modelo1=CIVIC');

  it('adds a brand to a search without brand filters, keeping other filters', () => {
    const r = applyTreeTarget(none, { make: 'TOYOTA' });
    expect(r.kind).toBe('changed');
    if (r.kind !== 'changed') return;
    expect(r.state.groups).toEqual([{ make: 'TOYOTA', model: undefined, version: undefined }]);
    expect(r.state.params.get('anode')).toBe('2018');
    expect(r.state.page).toBe(1);
  });

  it('narrows the existing brand group with a model', () => {
    const r = applyTreeTarget(honda, { make: 'HONDA', model: 'CIVIC' });
    expect(r.kind === 'changed' && r.state.groups).toEqual([{ make: 'HONDA', model: 'CIVIC', version: undefined }]);
  });

  it('narrows the model group with a version', () => {
    const r = applyTreeTarget(civic, { make: 'HONDA', model: 'CIVIC', version: '2.0 16V FLEXONE EXL 4P CVT' });
    expect(r.kind === 'changed' && r.state.groups).toEqual([
      { make: 'HONDA', model: 'CIVIC', version: '2.0 16V FLEXONE EXL 4P CVT' },
    ]);
  });

  it('reports already-applied targets', () => {
    expect(applyTreeTarget(civic, { make: 'honda' }).kind).toBe('unchanged');
    expect(isTargetApplied(civic, { make: 'HONDA', model: 'civic' })).toBe(true);
    expect(isTargetApplied(civic, { make: 'HONDA', model: 'FIT' })).toBe(false);
  });

  it('refuses a fourth group', () => {
    const three = parseSearchUrl('/carros/sp?marca1=HONDA&modelo1=CIVIC&marca2=FIAT&modelo2=ARGO&marca3=JEEP&modelo3=RENEGADE');
    expect(applyTreeTarget(three, { make: 'TOYOTA' }).kind).toBe('limit');
  });

  it('keeps the blacklist', () => {
    const s = withBlacklist(none, addMake(EMPTY_BLACKLIST, 'FIAT'));
    const r = applyTreeTarget(s, { make: 'HONDA' });
    expect(r.kind === 'changed' && r.state.blacklist.makes).toEqual(['FIAT']);
  });
});

describe('narrowingPredicate', () => {
  const parent = parseSearchUrl('/carros/sp?anode=2018');
  const l = (make: string, model: string, version = 'X') => ({ make, model, version });

  it('selects the child results out of the parent results', () => {
    const child = parseSearchUrl('/carros/sp?anode=2018&marca1=HONDA&modelo1=CIVIC&page=3');
    const p = narrowingPredicate(parent, child)!;
    expect(p(l('HONDA', 'CIVIC'))).toBe(true);
    expect(p(l('HONDA', 'FIT'))).toBe(false);
  });

  it('rejects different filters or broader children', () => {
    expect(narrowingPredicate(parent, parseSearchUrl('/carros/sp?anode=2019&marca1=HONDA'))).toBeNull();
    expect(narrowingPredicate(parseSearchUrl('/carros/sp?marca1=HONDA&modelo1=CIVIC'), parseSearchUrl('/carros/sp?marca1=HONDA'))).toBeNull();
  });
});
