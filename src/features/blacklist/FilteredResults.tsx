import { useEffect, useRef } from 'preact/hooks';
import { formatBRL, formatInt, formatKm, plural, titleCase } from '../../lib/format';
import { useStore } from '../../lib/store';
import { adUrl, photoUrl } from '../../lib/webmotors/listing';
import type { ListingLite } from '../../lib/webmotors/types';
import { AlertIcon, BlockIcon, CalendarIcon, CarIcon, GaugeIcon, PinIcon } from '../../ui/icons';
import type { SearchPageApp } from '../search-page/app';
import { BlockedNotice } from '../search-page/BlockedNotice';
import { blacklistSize, EMPTY_BLACKLIST } from './blacklist';

/** Results list shown instead of the native one while a blacklist is active. */
export function FilteredResults({ app }: { app: SearchPageApp }) {
  const state = useStore(app.results.state);
  const search = useStore(app.search);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastPage = useRef(state.page);

  // After a page change, bring the top of the list into view (like the site does).
  useEffect(() => {
    if (state.page !== lastPage.current) {
      lastPage.current = state.page;
      const top = rootRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0 || top > window.innerHeight) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [state.page]);

  if (state.status === 'idle') return null;
  const loading = state.status === 'loading' && !state.items.length;
  const hidden = blacklistSize(search.blacklist);

  return (
    <div class="wmp-root wmp-res" ref={rootRef} aria-busy={state.status === 'loading'}>
      <div class="wmp-res__bar">
        <p class="wmp-res__count">
          {state.total !== undefined ? <strong>{plural(state.total, 'anúncio encontrado', 'anúncios encontrados')}</strong> : <span class="wmp-skeleton wmp-res__count-skeleton" />}
          {state.excluded !== undefined && state.excluded > 0 && (
            <span class="wmp-res__excluded">
              <BlockIcon size={14} /> {plural(state.excluded, 'oculto', 'ocultos')} pela lista negra ({hidden} {hidden === 1 ? 'item' : 'itens'})
            </span>
          )}
        </p>
        <button type="button" class="wmp-link" onClick={() => app.applyBlacklist(EMPTY_BLACKLIST)}>
          Mostrar todos
        </button>
      </div>

      {state.status === 'blocked' && <BlockedNotice app={app} until={state.blockedUntil} />}
      {state.status === 'error' && (
        <div class="wmp-notice" role="alert">
          <AlertIcon size={18} />
          <span>Não foi possível carregar os anúncios.</span>
          <button type="button" class="wmp-link" onClick={() => app.results.retry(app.session.get(), app.search.get())}>
            Tentar novamente
          </button>
        </div>
      )}

      <ul class="wmp-res__grid" aria-label="Anúncios">
        {loading
          ? Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <CardSkeleton />
              </li>
            ))
          : state.items.map((listing) => (
              <li key={listing.id}>
                <ResultCard listing={listing} />
              </li>
            ))}
      </ul>

      {state.status === 'ready' && state.items.length === 0 && (
        <div class="wmp-res__empty">
          <CarIcon size={32} />
          <p>
            <strong>Nenhum anúncio após aplicar a lista negra.</strong>
          </p>
          <button type="button" class="wmp-btn wmp-btn--secondary" onClick={() => app.applyBlacklist(EMPTY_BLACKLIST)}>
            Limpar lista negra
          </button>
        </div>
      )}

      {state.windowEnded && (
        <p class="wmp-res__window">
          A Webmotors mostra no máximo 10.000 anúncios por busca. Refine os filtros para ver os demais.
        </p>
      )}

      {state.totalPages !== undefined && state.totalPages > 1 && (
        <Pagination page={state.page} total={state.totalPages} onPage={(p) => app.goToPage(p)} />
      )}
    </div>
  );
}

function ResultCard({ listing: l }: { listing: ListingLite }) {
  const href = adUrl(l);
  const image = photoUrl(l.photo);
  const title = `${l.make} ${l.model}`;
  const years = l.yearFab && l.yearFab !== l.yearModel ? `${l.yearFab}/${l.yearModel}` : `${l.yearModel}/${l.yearModel}`;
  return (
    <article class="wmp-card">
      <a class="wmp-card__media" href={href} tabIndex={-1} aria-hidden="true">
        {image ? <img src={image} alt="" loading="lazy" decoding="async" width={242} height={190} /> : <CarIcon size={40} />}
      </a>
      <div class="wmp-card__body">
        {l.featured && <span class="wmp-card__badge">Oferta Destaque</span>}
        <a class="wmp-card__link" href={href}>
          <h2 class="wmp-card__title">{title}</h2>
        </a>
        <h3 class="wmp-card__version" title={l.version}>
          {l.version.toLowerCase()}
        </h3>
        <div class="wmp-card__cells">
          <span>
            <CalendarIcon size={16} /> {years}
          </span>
          <span>
            <GaugeIcon size={16} /> {formatKm(l.km)}
          </span>
        </div>
        {l.city && (
          <p class="wmp-card__place">
            <PinIcon size={16} /> {titleCase(l.city)} {l.uf && `(${l.uf})`}
          </p>
        )}
        <p class="wmp-card__price">{l.price > 0 ? formatBRL(l.price) : 'Consulte'}</p>
        {l.financing && (
          <p class="wmp-card__financing">
            a partir de <strong>{formatBRL(l.financing)}/mês*</strong>
          </p>
        )}
      </div>
    </article>
  );
}

function CardSkeleton() {
  return (
    <div class="wmp-card wmp-card--skeleton" aria-hidden="true">
      <div class="wmp-card__media wmp-skeleton" />
      <div class="wmp-card__body">
        <span class="wmp-skeleton" style={{ height: '20px', width: '70%' }} />
        <span class="wmp-skeleton" style={{ height: '16px', width: '90%' }} />
        <span class="wmp-skeleton" style={{ height: '16px', width: '50%' }} />
        <span class="wmp-skeleton" style={{ height: '24px', width: '60%' }} />
      </div>
    </div>
  );
}

function pageList(page: number, total: number): Array<number | '…'> {
  const pages = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1]! > 1) out.push('…');
    out.push(p);
  });
  return out;
}

function Pagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  return (
    <nav class="wmp-pages" aria-label="Paginação dos anúncios">
      <button type="button" class="wmp-pages__step" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </button>
      <ol class="wmp-pages__list">
        {pageList(page, total).map((p, i) =>
          p === '…' ? (
            <li key={`gap-${i}`} class="wmp-pages__gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={p}>
              <button
                type="button"
                class="wmp-pages__page"
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Página ${formatInt(p)}`}
                onClick={() => p !== page && onPage(p)}
              >
                {formatInt(p)}
              </button>
            </li>
          ),
        )}
      </ol>
      <button type="button" class="wmp-pages__step" disabled={page >= total} onClick={() => onPage(page + 1)}>
        Próxima
      </button>
    </nav>
  );
}
