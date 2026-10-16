/** Subset of the `/api/search/car` response the extension uses. */
export interface RawListing {
  UniqueId: number;
  PhotoPath?: string;
  Media?: { Photos?: Array<{ PhotoPath: string; Order: number }> };
  Specification: {
    Title?: string;
    Make: { id?: number; Value: string };
    Model: { id?: number; Value: string };
    Version: { id?: number; Value: string };
    YearFabrication: string | number;
    YearModel: number;
    Odometer?: number;
    Transmission?: string;
    NumberPorts?: string;
    BodyType?: string;
    EngineSize?: string;
    HorsePower?: string;
    Traction?: string;
  };
  Seller?: { City?: string; State?: string };
  Prices: { Price: number; SearchPrice?: number; FinancingStartValue?: number };
  FipePercent?: number | null;
  GoodDeal?: boolean;
  HotDeal?: Array<{ Id?: string; Value?: string }> | null;
  ListingType?: 'U' | 'N' | string;
  MediaZeroKm?: boolean;
}

export interface FacetItem {
  name: string;
  count: number;
  selected?: boolean | null;
  items?: FacetItem[] | null;
}

export interface Facet {
  name: string;
  items: FacetItem[];
}

export interface SearchResponse {
  SearchResults: RawListing[];
  Count: number;
  Pagination?: { PageCurrent: number; PageTotal: number };
  Filters?: Facet[];
}

export interface AutocompleteBrand {
  name: string;
  items: Array<{ name: string }>;
}

export interface GenAiResponse {
  success: boolean;
  response?: { url?: string };
  message?: string;
}

/** Compact listing kept in memory (≈ 300 bytes instead of ≈ 3.3 KB). */
export interface ListingLite {
  id: number;
  make: string;
  model: string;
  version: string;
  yearModel: number;
  yearFab: number;
  price: number;
  fipePercent?: number;
  km: number;
  city: string;
  uf: string;
  doors: string;
  photo?: string;
  engine?: string;
  hp?: string;
  transmission?: string;
  traction?: string;
  body?: string;
  financing?: number;
  featured: boolean;
  zeroKm: boolean;
}
