import type { FuelCode } from './normalize';
import type { FipeCandidate } from './types';

export interface FipeReference {
  code: string;
  month: string;
}

export interface FipePrice {
  value: number;
  code: string;
  label: string;
  month: string;
}

export interface FipeSource {
  readonly name: 'fipe' | 'parallelum';
  reference(): Promise<FipeReference>;
  brands(ref: string): Promise<Array<{ code: string; name: string }>>;
  /** All versions of a brand for a model year (32000 = zero km) and fuel. */
  modelsByYear(ref: string, brand: string, year: number, fuel: FuelCode): Promise<FipeCandidate[]>;
  price(ref: string, brand: string, model: string, year: number, fuel: FuelCode): Promise<FipePrice | null>;
}

export class FipeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly source: string,
  ) {
    super(`${source}: HTTP ${status}`);
    this.name = 'FipeHttpError';
  }
}

/** "R$ 118.358,00" → 118358 */
export function parseBRL(value: string): number {
  const digits = value.replace(/[^\d,]/g, '').replace(',', '.');
  return Math.round(Number.parseFloat(digits));
}

/** Official FIPE site API (form-encoded POST, CORS *). */
export class OfficialFipeSource implements FipeSource {
  readonly name = 'fipe' as const;
  private readonly base = 'https://veiculos.fipe.org.br/api/veiculos';

  constructor(private readonly fetchImpl: typeof fetch = (i, init) => fetch(i, init)) {}

  private async post<T>(method: string, params: Record<string, string | number> = {}): Promise<T | null> {
    const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const res = await this.fetchImpl(`${this.base}/${method}`, { method: 'POST', body });
    if (!res.ok) throw new FipeHttpError(res.status, this.name);
    const json = (await res.json()) as T | { erro?: string };
    if (json && typeof json === 'object' && !Array.isArray(json) && 'erro' in json && json.erro) return null;
    return json as T;
  }

  async reference(): Promise<FipeReference> {
    const list = await this.post<Array<{ Codigo: number; Mes: string }>>('ConsultarTabelaDeReferencia');
    const first = list?.[0];
    if (!first) throw new Error('FIPE sem tabela de referência');
    return { code: String(first.Codigo), month: first.Mes.trim() };
  }

  async brands(ref: string) {
    const list = await this.post<Array<{ Label: string; Value: string }>>('ConsultarMarcas', {
      codigoTabelaReferencia: ref,
      codigoTipoVeiculo: 1,
    });
    return (list ?? []).map((b) => ({ code: String(b.Value), name: b.Label }));
  }

  async modelsByYear(ref: string, brand: string, year: number, fuel: FuelCode) {
    const list = await this.post<Array<{ Label: string; Value: string }>>('ConsultarModelosAtravesDoAno', {
      codigoTipoVeiculo: 1,
      codigoTabelaReferencia: ref,
      codigoMarca: brand,
      ano: `${year}-${fuel}`,
      codigoTipoCombustivel: fuel,
      anoModelo: year,
    });
    return (list ?? []).map((m) => ({ code: String(m.Value), label: m.Label.replace(/\s+/g, ' ').trim() }));
  }

  async price(ref: string, brand: string, model: string, year: number, fuel: FuelCode) {
    const r = await this.post<{ Valor: string; CodigoFipe: string; Modelo: string; MesReferencia: string }>(
      'ConsultarValorComTodosParametros',
      {
        codigoTabelaReferencia: ref,
        codigoMarca: brand,
        codigoModelo: model,
        codigoTipoVeiculo: 1,
        anoModelo: year,
        codigoTipoCombustivel: fuel,
        tipoVeiculo: 'carro',
        modeloCodigoExterno: '',
        tipoConsulta: 'tradicional',
      },
    );
    if (!r?.Valor) return null;
    return { value: parseBRL(r.Valor), code: r.CodigoFipe, label: r.Modelo, month: r.MesReferencia.trim() };
  }
}

/** fipe.parallelum.com.br v2 — same codes as FIPE; 500 requests/day per IP. */
export class ParallelumFipeSource implements FipeSource {
  readonly name = 'parallelum' as const;
  private readonly base = 'https://fipe.parallelum.com.br/api/v2';
  /** Requests left today, from `x-ratelimit-remaining`. */
  remaining = Number.POSITIVE_INFINITY;

  constructor(private readonly fetchImpl: typeof fetch = (i, init) => fetch(i, init)) {}

  private async get<T>(path: string): Promise<T | null> {
    const res = await this.fetchImpl(`${this.base}${path}`);
    const left = Number(res.headers.get('x-ratelimit-remaining'));
    if (Number.isFinite(left) && res.headers.has('x-ratelimit-remaining')) this.remaining = left;
    if (res.status === 404) return null;
    if (!res.ok) throw new FipeHttpError(res.status, this.name);
    return (await res.json()) as T;
  }

  async reference(): Promise<FipeReference> {
    const list = await this.get<Array<{ code: string; month: string }>>('/references');
    const first = list?.[0];
    if (!first) throw new Error('Parallelum sem referência');
    return { code: first.code, month: first.month };
  }

  async brands() {
    return (await this.get<Array<{ code: string; name: string }>>('/cars/brands')) ?? [];
  }

  async modelsByYear(ref: string, brand: string, year: number, fuel: FuelCode) {
    const list = await this.get<Array<{ code: string; name: string }>>(
      `/cars/brands/${brand}/years/${year}-${fuel}/models?reference=${ref}`,
    );
    return (list ?? []).map((m) => ({ code: m.code, label: m.name.replace(/\s+/g, ' ').trim() }));
  }

  async price(ref: string, brand: string, model: string, year: number, fuel: FuelCode) {
    const r = await this.get<{ price: string; codeFipe: string; model: string; referenceMonth: string }>(
      `/cars/brands/${brand}/models/${model}/years/${year}-${fuel}?reference=${ref}`,
    );
    if (!r?.price) return null;
    return { value: parseBRL(r.price), code: r.codeFipe, label: r.model, month: r.referenceMonth };
  }
}
