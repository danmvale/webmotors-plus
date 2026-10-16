import { describe, expect, it } from 'vitest';
import {
  addMake,
  addModel,
  blacklistSize,
  createExclusionTest,
  decodeBlacklist,
  EMPTY_BLACKLIST,
  encodeBlacklist,
  removeMake,
  removeModel,
  sameBlacklist,
  withoutSelected,
} from '../src/features/blacklist/blacklist';

describe('blacklist codec', () => {
  it('round-trips through URL params', () => {
    const bl = addModel(addMake(addMake(EMPTY_BLACKLIST, 'Fiat'), 'CAOA CHERY'), 'VOLKSWAGEN', 'T-CROSS');
    const params = new URLSearchParams('marca1=HONDA');
    encodeBlacklist(bl, params);
    expect(params.get('excluir_marcas')).toBe('FIAT|CAOA CHERY');
    expect(params.get('excluir_modelos')).toBe('VOLKSWAGEN:T-CROSS');
    expect(decodeBlacklist(params)).toEqual(bl);
  });

  it('drops malformed, duplicate and redundant entries', () => {
    const bl = decodeBlacklist(
      new URLSearchParams('excluir_marcas=FIAT||fiat&excluir_modelos=FIAT:ARGO|HONDA:FIT|honda:fit|:X|SEMMODELO'),
    );
    expect(bl).toEqual({ makes: ['FIAT'], models: [{ make: 'HONDA', model: 'FIT' }] });
  });

  it('removes the params when empty', () => {
    const params = new URLSearchParams('excluir_marcas=FIAT&page=1');
    encodeBlacklist(EMPTY_BLACKLIST, params);
    expect(params.toString()).toBe('page=1');
  });
});

describe('blacklist edits', () => {
  it('adding a brand absorbs its models', () => {
    const bl = addMake(addModel(EMPTY_BLACKLIST, 'HONDA', 'FIT'), 'HONDA');
    expect(bl).toEqual({ makes: ['HONDA'], models: [] });
    expect(addModel(bl, 'HONDA', 'CIVIC')).toBe(bl);
  });

  it('is unlimited and removable', () => {
    let bl = EMPTY_BLACKLIST;
    for (const make of ['FIAT', 'CHEVROLET', 'VOLKSWAGEN', 'RENAULT', 'PEUGEOT', 'CITROEN', 'NISSAN']) bl = addMake(bl, make);
    bl = addModel(bl, 'TOYOTA', 'ETIOS');
    expect(blacklistSize(bl)).toBe(8);
    bl = removeModel(removeMake(bl, 'fiat'), 'toyota', 'etios');
    expect(blacklistSize(bl)).toBe(6);
    expect(bl.makes.includes('FIAT')).toBe(false);
  });

  it('compares ignoring order', () => {
    const a = addMake(addMake(EMPTY_BLACKLIST, 'A'), 'B');
    const b = addMake(addMake(EMPTY_BLACKLIST, 'B'), 'A');
    expect(sameBlacklist(a, b)).toBe(true);
    expect(sameBlacklist(a, EMPTY_BLACKLIST)).toBe(false);
  });
});

describe('createExclusionTest', () => {
  const test = createExclusionTest(addModel(addMake(EMPTY_BLACKLIST, 'FIAT'), 'HONDA', 'FIT'));
  it.each([
    ['FIAT', 'ARGO', true],
    ['Fiat', 'Strada', true],
    ['HONDA', 'FIT', true],
    ['HONDA', 'CIVIC', false],
    ['TOYOTA', 'FIT', false],
  ])('%s %s → %s', (make, model, expected) => expect(test(make, model)).toBe(expected));

  it('excludes nothing when empty', () => {
    expect(createExclusionTest(EMPTY_BLACKLIST)('FIAT', 'ARGO')).toBe(false);
  });
});

describe('withoutSelected', () => {
  it('lets a brand or model picked in the site filters leave the blacklist', () => {
    let bl = addMake(EMPTY_BLACKLIST, 'FIAT');
    bl = addModel(bl, 'HONDA', 'FIT');
    bl = addModel(bl, 'VOLKSWAGEN', 'GOL');
    const next = withoutSelected(bl, [{ make: 'Fiat', model: 'TORO' }, { make: 'VOLKSWAGEN', model: 'GOL' }]);
    expect(next.makes).toEqual([]);
    expect(next.models).toEqual([{ make: 'HONDA', model: 'FIT' }]);
  });

  it('keeps a blacklisted model of a selected brand', () => {
    const bl = addModel(EMPTY_BLACKLIST, 'HONDA', 'FIT');
    expect(withoutSelected(bl, [{ make: 'HONDA' }])).toBe(bl);
  });
});
