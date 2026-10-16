/**
 * Webmotors-compatible slug: "1.5 16V TURBO GASOLINA TOURING 4P CVT" →
 * "15-16v-turbo-gasolina-touring-4p-cvt", "2.0 DI e:HEV" → "20-di-ehev".
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.:]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Case- and accent-insensitive key for comparing make/model/version names. */
export function nameKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
