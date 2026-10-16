import type { VersionAttrs } from './types';

/** FIPE `codigoTipoCombustivel`: 1 gasolina, 2 álcool, 3 diesel, 4 elétrico, 5 flex, 6 híbrido. */
export type FuelCode = 1 | 2 | 3 | 4 | 5 | 6;

export interface Features {
  tokens: string[];
  displacement?: string;
  valves?: string;
  doors?: string;
  transmission?: 'AUT' | 'MAN';
  turbo: boolean;
  hp?: number;
  fuel?: FuelCode;
  drive?: '4X4' | '4X2';
  cab?: 'CD' | 'CS' | 'CE';
}

const AUTOMATIC = new Set([
  'AUT', 'AUTO', 'AUTOMATICO', 'AUTOMATICA', 'AUTOMATIZADO', 'AUTOMATIZADA', 'AT', 'CVT', 'ECVT', 'DCT', 'DSG',
  'TIPTRONIC', 'STRONIC', 'POWERSHIFT', 'DUALOGIC', 'IMOTION', 'XTRONIC', 'MULTIDRIVE', 'EASYTRONIC', 'IVT',
  'STEPTRONIC', 'PDK', 'GSR', 'EDC', 'EAT6', 'EAT8', 'AMT', 'IMT', 'SHIFT',
]);
const MANUAL = new Set(['MEC', 'MECANICO', 'MECANICA', 'MANUAL', 'MT']);
const TURBO = new Set(['TURBO', 'TB', 'TSI', 'TFSI', 'THP', 'TGDI', 'TJET', 'TURBODIESEL', 'TDI', 'ECOBOOST', 'GTDI', 'TCE']);
const FUEL_TOKENS: Record<string, FuelCode> = {
  FLEX: 5, FLEXONE: 5, TOTALFLEX: 5, FLEXFUEL: 5, FLEXSTART: 5, TETRAFUEL: 5, BICOMBUSTIVEL: 5,
  GASOLINA: 1,
  ALCOOL: 2, ETANOL: 2,
  DIESEL: 3, TURBODIESEL: 3, CRDI: 3, HDI: 3, TDI: 3,
  ELETRICO: 4, ELETRICA: 4, EV: 4, BEV: 4,
  HIBRIDO: 6, HIBRIDA: 6, HYBRID: 6, EHEV: 6, HEV: 6, PHEV: 6, MHEV: 6,
};
/**
 * Tokens that never discriminate between trims of the same model: filler words
 * and engine-family names Webmotors includes but FIPE labels usually omit.
 */
const GENERIC = new Set([
  'P', 'V', 'PORTAS', 'PTS', 'CV', 'C', 'DE', 'E', 'COM', 'NOVO', 'NOVA', 'MOD', 'TOTAL', 'DIRECT',
  'FIRE', 'FIREFLY', 'EVO', 'ETORQ', 'VVT', 'VVTI', 'VVTIE', 'DUALVVTI', 'MPI', 'MULTIAIR', 'SIDI', 'GDI', 'DOHC', 'SOHC',
]);
/** FIPE's abbreviations that are not simple prefixes of the full word. */
const SYNONYMS: Record<string, string> = {
  SD: 'SEDAN',
  SED: 'SEDAN',
  SEDA: 'SEDAN',
  HATCHBACK: 'HATCH',
  DIES: 'DIESEL',
  HIBR: 'HIBRIDO',
};

export function tokenize(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[():;,/+]/g, ' ')
    // "TYPE-R" = "TYPE R", "C-180" = "C 180"; keep "-" inside numbers-only codes.
    .replace(/(?<=\p{L})-|-(?=\p{L})/gu, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/[-:'"]/g, ''))
    .filter(Boolean)
    .map((t) => SYNONYMS[t] ?? t);
}

export function extractFeatures(text: string, attrs: VersionAttrs = {}): Features {
  const tokens = tokenize(text);
  const f: Features = { tokens, turbo: false };
  for (const t of tokens) {
    if (!f.displacement && /^\d\.\d$/.test(t)) f.displacement = t;
    else if (!f.valves && /^\d{1,2}V$/.test(t)) f.valves = t;
    else if (!f.doors && /^\dP$/.test(t)) f.doors = t[0];
    else if (!f.hp && /^\d{2,3}CV$/.test(t)) f.hp = Number.parseInt(t, 10);
    if (!f.transmission && AUTOMATIC.has(t)) f.transmission = 'AUT';
    if (!f.transmission && MANUAL.has(t)) f.transmission = 'MAN';
    if (TURBO.has(t)) f.turbo = true;
    if (!f.fuel && t in FUEL_TOKENS) f.fuel = FUEL_TOKENS[t];
    if (!f.drive && (t === '4X4' || t === 'AWD' || t === '4WD')) f.drive = '4X4';
    if (!f.drive && t === '4X2') f.drive = '4X2';
    if (!f.cab && (t === 'CD' || t === 'CS' || t === 'CE')) f.cab = t;
  }

  // Structured Webmotors attributes take precedence over text heuristics.
  const engine = attrs.engine?.replace(',', '.').match(/\d\.\d/)?.[0];
  if (engine) f.displacement = engine;
  const hp = attrs.hp ? Number.parseInt(attrs.hp, 10) : Number.NaN;
  if (Number.isFinite(hp) && hp > 0) f.hp = hp;
  const transmission = attrs.transmission ? tokenize(attrs.transmission)[0] : undefined;
  if (transmission && (AUTOMATIC.has(transmission) || transmission.startsWith('AUTOM'))) f.transmission = 'AUT';
  else if (transmission && MANUAL.has(transmission)) f.transmission = 'MAN';
  if (attrs.doors && /^\d$/.test(attrs.doors)) f.doors = attrs.doors;
  if (attrs.traction && /4X4|INTEGRAL|AWD/i.test(attrs.traction)) f.drive = '4X4';
  return f;
}

/** Tokens that describe the trim (everything that is not a technical feature). */
export function trimTokens(f: Features, exclude: Iterable<string> = []): Set<string> {
  const skip = new Set(exclude);
  const out = new Set<string>();
  for (const t of f.tokens) {
    if (skip.has(t) || GENERIC.has(t)) continue;
    if (/^\d\.\d$/.test(t) || /^\d{1,2}V$/.test(t) || /^\dP$/.test(t) || /^\d{2,3}CV$/.test(t)) continue;
    if (AUTOMATIC.has(t) || MANUAL.has(t) || TURBO.has(t) || t in FUEL_TOKENS) continue;
    if (t === '4X4' || t === '4X2' || t === 'AWD' || t === '4WD') continue;
    out.add(t);
  }
  return out;
}

/** Fuel guesses to try with FIPE, most likely first. */
export function fuelCandidates(f: Features): FuelCode[] {
  const order: FuelCode[] = [5, 1, 3, 6, 4];
  return f.fuel ? [f.fuel, ...order.filter((x) => x !== f.fuel)] : order;
}

const BRAND_ALIASES: Record<string, string[]> = {
  CHEVROLET: ['GM - CHEVROLET', 'CHEVROLET'],
  VOLKSWAGEN: ['VW - VOLKSWAGEN', 'VOLKSWAGEN'],
  KIA: ['KIA MOTORS', 'KIA'],
  'CAOA CHERY': ['CAOA CHERY', 'CAOA CHERY/CHERY', 'CHERY'],
  CHERY: ['CHERY', 'CAOA CHERY/CHERY'],
  'MERCEDES-BENZ': ['MERCEDES-BENZ', 'MERCEDES BENZ'],
  'LAND ROVER': ['LAND ROVER', 'LANDROVER'],
  RAM: ['RAM', 'DODGE'],
  GWM: ['GWM', 'GREAT WALL'],
  'CAOA CHANGAN': ['CHANGAN', 'CAOA CHANGAN'],
};

export function brandKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Finds the FIPE brand code for a Webmotors make name. */
export function findBrandCode(make: string, brands: Array<{ code: string; name: string }>): string | undefined {
  const byName = new Map(brands.map((b) => [brandKey(b.name), b.code]));
  const wanted = brandKey(make);
  for (const alias of BRAND_ALIASES[wanted] ?? [wanted]) {
    const code = byName.get(alias);
    if (code) return code;
  }
  const compact = (s: string) => s.replace(/[^A-Z0-9]/g, '');
  const target = compact(wanted);
  return brands.find((b) => compact(brandKey(b.name)) === target)?.code;
}
