export const WM_ORIGIN = 'https://www.webmotors.com.br';

/** Cards per page on the native results page. */
export const PAGE_SIZE = 47;

/** Server page size used when the extension crawls listings (fewer, larger requests). */
export const CHUNK_SIZE = 1000;

/** Searches that fit in one request are crawled completely; larger ones load on demand. */
export const EAGER_LIMIT = 1000;

/** Expanding a model crawls it when it has at most this many listings; larger ones load per year. */
export const MODEL_CRAWL_LIMIT = 2000;

/** The search API never returns results past this offset. */
export const RESULT_WINDOW = 10_000;

/** Webmotors' search filters accept at most three marca/modelo/versao groups. */
export const MAX_GROUPS = 3;

// Request discipline (PerimeterX bot protection).
/** Minimum gap between two requests of a tab: user-initiated vs background work. */
export const MIN_SPACING_MS = { high: 1200, low: 2500 } as const;
export const IDLE_START_DELAY_MS = 2500;
/** Cross-tab budget: short bursts are fine, sustained crawling is not (≈ 30 requests per 10 min). */
export const GLOBAL_RATE_PER_MIN = 15;
export const GLOBAL_BURST = 3;
export const GLOBAL_SUSTAINED_RATE_PER_MIN = 3;
export const GLOBAL_SUSTAINED_BURST = 15;
export const PX_COOLDOWN_MS = 5 * 60_000;

/** Search responses are reused across page loads (reload, back from an ad) for this long. */
export const SEARCH_CACHE_TTL_MS = 10 * 60_000;
/** `storage.session` holds 10 MB; leave headroom for everything else. */
export const SEARCH_CACHE_MAX_BYTES = 7 * 1024 * 1024;

// FIPE.
export const FIPE_CONCURRENCY = 2;
export const FIPE_SPACING_MS = 250;
export const FIPE_VALIDATION_TOLERANCE = 0.02;
export const FIPE_CANDIDATES_TO_PRICE = 3;
export const FIPE_MAPPING_VERSION = 2;

export const AUTOCOMPLETE_TTL_MS = 24 * 60 * 60 * 1000;

export const PHOTO_BASE = 'https://image.webmotors.com.br/_fotos/anunciousados/gigante/';

export const BLACKLIST_PARAMS = {
  makes: 'excluir_marcas',
  models: 'excluir_modelos',
} as const;
