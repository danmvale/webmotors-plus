import { extractFeatures, type Features, tokenize, trimTokens } from './normalize';
import type { FipeCandidate, VersionAttrs } from './types';

export interface MatchQuery {
  model: string;
  version: string;
  attrs?: VersionAttrs;
}

export interface ScoredCandidate extends FipeCandidate {
  score: number;
}

/** True when the FIPE label begins with the Webmotors model ("GOL" ≠ "GOLF", "C 180" = "C-180"). */
export function labelStartsWithModel(labelTokens: string[], model: string): number {
  const modelTokens = tokenize(model);
  if (!modelTokens.length) return 0;
  if (modelTokens.every((t, i) => labelTokens[i] === t)) return modelTokens.length;
  const compactModel = modelTokens.join('');
  let joined = '';
  for (let k = 0; k < Math.min(labelTokens.length, 4); k++) {
    joined += labelTokens[k];
    if (joined === compactModel) return k + 1;
    if (!compactModel.startsWith(joined)) break;
  }
  return 0;
}

/**
 * 1 for an exact token, 0.9 for an abbreviation (PREM. ↔ PREMIER, Hig. ↔
 * HIGHLINE), else 0. Records the matched candidate token in `used`.
 */
export function tokenSimilarity(token: string, candidates: Set<string>, used?: Set<string>): number {
  if (candidates.has(token)) {
    used?.add(token);
    return 1;
  }
  for (const c of candidates) {
    if (/^\d/.test(c) || /^\d/.test(token)) continue;
    if ((c.length >= 3 && token.startsWith(c)) || (token.length >= 3 && c.startsWith(token))) {
      used?.add(c);
      return 0.9;
    }
  }
  return 0;
}

function conflicts(q: Features, c: Features): boolean {
  if (q.displacement && c.displacement && q.displacement !== c.displacement) return true;
  if (q.transmission && c.transmission && q.transmission !== c.transmission) return true;
  if (q.doors && c.doors && q.doors !== c.doors) return true;
  if (q.drive && c.drive && q.drive !== c.drive) return true;
  if (q.cab && c.cab && q.cab !== c.cab) return true;
  return false;
}

/**
 * Ranks FIPE candidates (same brand, year and fuel) for a Webmotors version.
 * Hard rules drop technical conflicts (engine, gearbox, doors, drive, cab);
 * the score is an IDF-weighted overlap of trim words, so rare words such as
 * EXL, LTZ or HIGHLINE decide between otherwise identical labels.
 */
export function rankCandidates(query: MatchQuery, candidates: FipeCandidate[]): ScoredCandidate[] {
  const q = extractFeatures(query.version, query.attrs);
  const modelTokens = tokenize(query.model);

  let pool = candidates.map((c) => {
    const tokens = tokenize(c.label);
    return { candidate: c, tokens, prefix: labelStartsWithModel(tokens, query.model) };
  });
  const withPrefix = pool.filter((p) => p.prefix > 0);
  if (withPrefix.length) pool = withPrefix;

  const prepared = pool
    .map((p) => {
      const features = extractFeatures(p.candidate.label);
      const trim = trimTokens(features, p.prefix ? p.tokens.slice(0, p.prefix) : modelTokens);
      return { ...p, features, trim };
    })
    .filter((p) => !conflicts(q, p.features));
  if (!prepared.length) return [];

  const qTrim = [...trimTokens(q, modelTokens)];
  const n = prepared.length;
  // Document frequency of each candidate token, and of each query token
  // (counting abbreviations such as PREM. for PREMIER).
  const df = new Map<string, number>();
  for (const p of prepared) for (const t of p.trim) df.set(t, (df.get(t) ?? 0) + 1);
  const qdf = new Map(qTrim.map((t) => [t, prepared.filter((p) => tokenSimilarity(t, p.trim) > 0).length]));
  const weight = (t: string) => Math.log(1 + n / Math.max(0.5, qdf.get(t) ?? df.get(t) ?? 0));

  return prepared
    .map((p) => {
      let shared = 0;
      let qTotal = 0;
      const used = new Set<string>();
      for (const t of qTrim) {
        const w = weight(t);
        qTotal += w;
        const similarity = tokenSimilarity(t, p.trim, used);
        shared += w * similarity;
      }
      let extra = 0;
      for (const t of p.trim) if (!used.has(t)) extra += weight(t);
      const recall = qTotal ? shared / qTotal : 1;
      // Prefer labels without unexplained extra words (e.g. HATCH over SEDAN PLUS LT).
      const extraPenalty = extra / (extra + shared + 1);
      let score = 0.7 * recall + 0.3 * (1 - extraPenalty);

      const c = p.features;
      if (q.turbo !== c.turbo) score -= 0.1;
      if (q.transmission && c.transmission === q.transmission) score += 0.05;
      if (q.valves && c.valves === q.valves) score += 0.03;
      if (q.doors && c.doors === q.doors) score += 0.02;
      if (q.hp && c.hp && Math.abs(q.hp - c.hp) <= 3) score += 0.05;
      if (q.displacement && c.displacement === q.displacement) score += 0.05;
      if (!q.displacement || !c.displacement) score -= 0.05;
      return { ...p.candidate, score: Math.round(score * 1000) / 1000 };
    })
    .sort((a, b) => b.score - a.score);
}

/** Without a price check, accept the best candidate only when it clearly wins. */
export function isConfidentWithoutPrice(ranked: ScoredCandidate[]): boolean {
  const [best, second] = ranked;
  if (!best || best.score < 0.6) return false;
  return !second || best.score - second.score >= 0.15;
}
