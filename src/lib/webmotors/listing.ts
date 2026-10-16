import { PHOTO_BASE } from '../config';
import { slugify } from './slug';
import type { ListingLite, RawListing } from './types';

export function toListingLite(raw: RawListing): ListingLite | null {
  const spec = raw.Specification;
  if (!raw.UniqueId || raw.MediaZeroKm || !spec?.Make?.Value) return null;
  const state = raw.Seller?.State ?? '';
  const uf = /\(([A-Z]{2})\)/.exec(state)?.[1] ?? state;
  const photo = raw.PhotoPath ?? raw.Media?.Photos?.[0]?.PhotoPath;
  return {
    id: raw.UniqueId,
    make: spec.Make.Value,
    model: spec.Model?.Value ?? '',
    version: spec.Version?.Value ?? '',
    yearModel: Number(spec.YearModel) || 0,
    yearFab: Number(spec.YearFabrication) || Number(spec.YearModel) || 0,
    price: Number(raw.Prices?.Price) || 0,
    fipePercent: typeof raw.FipePercent === 'number' && raw.FipePercent > 0 ? raw.FipePercent : undefined,
    km: Number(spec.Odometer) || 0,
    city: raw.Seller?.City ?? '',
    uf,
    doors: spec.NumberPorts ?? '',
    photo: photo || undefined,
    engine: spec.EngineSize || undefined,
    hp: spec.HorsePower || undefined,
    transmission: spec.Transmission || undefined,
    traction: spec.Traction || undefined,
    body: spec.BodyType || undefined,
    financing: raw.Prices?.FinancingStartValue || undefined,
    featured: Array.isArray(raw.HotDeal) && raw.HotDeal.length > 0,
    zeroKm: raw.ListingType === 'N',
  };
}

/** `/comprar/honda/civic/20-di-ehev-advanced-e-cvt/4-portas/2024/81167830` */
export function adUrl(l: ListingLite): string {
  const year = l.yearFab && l.yearFab !== l.yearModel ? `${l.yearFab}-${l.yearModel}` : String(l.yearModel);
  const parts = [slugify(l.make), slugify(l.model), slugify(l.version)];
  if (l.doors) parts.push(`${l.doors}-portas`);
  parts.push(year, String(l.id));
  return `/comprar/${parts.join('/')}`;
}

export function photoUrl(path: string | undefined, width = 242, height = 190): string | undefined {
  if (!path) return undefined;
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${PHOTO_BASE}${clean}?s=fill&w=${width}&h=${height}&q=70&type=webp`;
}
