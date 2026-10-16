const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** `R$ 118.358` — whole reais, like the site's cards. */
export function formatBRL(value: number): string {
  return `R$ ${integer.format(Math.round(value))}`;
}

export function formatInt(value: number): string {
  return integer.format(value);
}

export function formatKm(value: number): string {
  return `${integer.format(value)} Km`;
}

export function plural(count: number, one: string, many: string): string {
  return `${formatInt(count)} ${count === 1 ? one : many}`;
}

/** "HONDA" → "Honda", "LAND ROVER" → "Land Rover" (for chips, like the site's own). */
export function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Letter-only names that read as acronyms although they contain a vowel. */
const ACRONYMS = new Set([
  'AMG', 'ASX', 'CLA', 'CLS', 'EQA', 'EQB', 'EQC', 'EQE', 'EQS', 'GLA', 'GLB', 'GLC', 'GLE', 'GLK', 'GLS',
  'GTI', 'GTS', 'JAC', 'JCW', 'RAM', 'SLC', 'SRT', 'SUV',
]);
/** Short names that are words, not acronyms. */
const SHORT_WORDS = new Set(['KA', 'UP']);

function nameSegment(segment: string): string {
  const letters = segment.replace(/[^\p{L}]/gu, '');
  if (!letters || /\d/.test(segment) || ACRONYMS.has(segment)) return segment;
  if ((letters.length <= 2 && !SHORT_WORDS.has(letters)) || !/[AEIOUÁÉÍÓÚÂÊÔÃÕ]/.test(letters)) return segment;
  return segment.charAt(0) + segment.slice(1).toLowerCase();
}

/**
 * Display form of the API's uppercase brand/model names, as the site's filter
 * chips show them: "Honda Civic", "Mercedes-Benz GLA", "BMW X1", "Honda HR-V".
 */
export function vehicleName(value: string): string {
  if (value !== value.toUpperCase()) return value;
  return value
    .split(' ')
    .map((word) => word.split('-').map(nameSegment).join('-'))
    .join(' ');
}
