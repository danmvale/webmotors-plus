/** Structured listing attributes (most common value within a version group). */
export interface VersionAttrs {
  engine?: string;
  hp?: string;
  transmission?: string;
  doors?: string;
  traction?: string;
  body?: string;
}

export interface FipeQuery {
  make: string;
  model: string;
  version: string;
  year: number;
  zeroKm: boolean;
  /** Median of Price × 100 / FipePercent over the group's listings. */
  implied?: number;
  impliedSamples: number;
  attrs: VersionAttrs;
}

export interface FipeResult {
  value: number;
  code: string;
  label: string;
  month: string;
  /**
   * `validated`: matched and agrees with Webmotors' own FIPE percentage.
   * `matched`: clear name match. `approximate`: FIPE's only version of the model.
   */
  confidence: 'validated' | 'matched' | 'approximate';
  source: 'fipe' | 'parallelum';
}

export interface FipeCandidate {
  code: string;
  label: string;
}
