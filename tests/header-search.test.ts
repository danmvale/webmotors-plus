import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  exactMatch,
  readRecent,
  saveRecent,
  suggest,
  suggestionUrl,
  vehicleTypeFor,
} from '../src/features/header-search/search';
import type { AutocompleteBrand } from '../src/lib/webmotors/types';

const brands: AutocompleteBrand[] = [
  { name: 'HONDA', items: [{ name: 'CIVIC' }, { name: 'FIT' }, { name: 'HR-V' }] },
  { name: 'VOLKSWAGEN', items: [{ name: 'T-CROSS' }, { name: 'GOL' }, { name: 'GOLF' }] },
  { name: 'LAND ROVER', items: [{ name: 'DISCOVERY' }] },
  { name: 'FORD', items: [{ name: 'FIESTA' }] },
];

describe('exactMatch', () => {
  it.each([
    ['honda', 'make', 'HONDA', undefined],
    ['Honda Civic', 'model', 'HONDA', 'CIVIC'],
    ['civic', 'model', 'HONDA', 'CIVIC'],
    ['land rover', 'make', 'LAND ROVER', undefined],
  ])('“%s”', (query, kind, make, model) => {
    expect(exactMatch(brands, query)).toMatchObject({ kind, make, ...(model ? { model } : {}) });
  });

  it('leaves natural-language queries to the AI', () => {
    expect(exactMatch(brands, 'SUV automático até 100 mil')).toBeUndefined();
    expect(exactMatch(brands, 'civic 2020 até 120 mil')).toBeUndefined();
  });
});

describe('suggest', () => {
  it('finds brands and models fuzzily', () => {
    const index = buildIndex(brands);
    expect(suggest(index, 'civc').map((s) => s.label)).toContain('Honda Civic');
    expect(suggest(index, 'h')).toEqual([]);
  });
});

describe('suggestionUrl', () => {
  it('builds the site URL and keeps the current search location', () => {
    const url = suggestionUrl(
      { kind: 'model', make: 'HONDA', model: 'CIVIC', label: 'Honda Civic' },
      'civic',
      new URL('https://www.webmotors.com.br/carros/sp?estadocidade=S%C3%A3o%20Paulo&page=3'),
    );
    const u = new URL(url, 'https://www.webmotors.com.br');
    expect(u.pathname).toBe('/carros/sp/honda/civic');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      tipoveiculo: 'carros',
      estadocidade: 'São Paulo',
      marca1: 'HONDA',
      modelo1: 'CIVIC',
      autocomplete: 'civic',
      autocompleteTerm: 'Honda Civic',
    });
  });

  it('uses the national stock elsewhere', () => {
    const url = suggestionUrl({ kind: 'make', make: 'LAND ROVER', label: 'Land Rover' }, '', new URL('https://www.webmotors.com.br/'));
    expect(url.startsWith('/carros/estoque/land-rover?')).toBe(true);
  });
});

describe('recent searches (shared with the homepage bar)', () => {
  it('keeps the 3 most recent, deduplicated', () => {
    localStorage.clear();
    for (const q of ['a', 'b', 'c', 'A', 'd']) saveRecent('car', { url: `https://x/${q}`, query: q });
    expect(readRecent('car').map((r) => r.query)).toEqual(['d', 'A', 'c']);
    expect(JSON.parse(localStorage.getItem('carros_lastAISearches')!)).toHaveLength(3);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('carros_lastAISearches', '{oops');
    expect(readRecent('car')).toEqual([]);
  });
});

describe('vehicleTypeFor', () => {
  it('detects motorcycle pages', () => {
    expect(vehicleTypeFor('/motos/estoque')).toBe('bike');
    expect(vehicleTypeFor('/carros/sp')).toBe('car');
    expect(vehicleTypeFor('/')).toBe('car');
  });
});

describe('typing without punctuation', () => {
  const brands = [
    { name: 'HONDA', items: [{ name: 'HR-V' }, { name: 'CIVIC' }] },
    { name: 'VOLKSWAGEN', items: [{ name: 'T-CROSS' }] },
  ];

  it('suggests and matches "HR-V" for "hrv"', () => {
    expect(suggest(buildIndex(brands), 'hrv').map((s) => s.label)).toContain('Honda HR-V');
    expect(exactMatch(brands, 'hrv')).toMatchObject({ make: 'HONDA', model: 'HR-V' });
    expect(exactMatch(brands, 'vw tcross')).toBeUndefined();
    expect(exactMatch(brands, 'volkswagen tcross')).toMatchObject({ model: 'T-CROSS' });
  });
});
