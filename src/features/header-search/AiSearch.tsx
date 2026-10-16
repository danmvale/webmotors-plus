import { Fragment, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Store } from '../../lib/store';
import { getAutocomplete, getClient } from '../../lib/webmotors/client';
import { PxBlockedError } from '../../lib/webmotors/px';
import type { AutocompleteBrand } from '../../lib/webmotors/types';
import { AlertIcon, CarIcon, ClockIcon, SearchIcon, SparkleIcon, Spinner } from '../../ui/icons';
import {
  buildIndex,
  EXAMPLE_PHRASES,
  exactMatch,
  readRecent,
  type RecentSearch,
  saveRecent,
  type Suggestion,
  suggest,
  suggestionUrl,
  vehicleTypeFor,
} from './search';

type Option =
  | { type: 'ai'; query: string }
  | { type: 'suggestion'; suggestion: Suggestion }
  | { type: 'recent'; recent: RecentSearch };

const PX_MESSAGE = 'A Webmotors pediu uma verificação de segurança. Recarregue a página e tente novamente.';
const GENERIC_ERROR = 'Não foi possível interpretar sua busca. Tente descrever de outro jeito.';

export function isShown(el: Element | null): boolean {
  if (!el?.getClientRects().length) return false;
  const host = (el.getRootNode() as ShadowRoot).host as HTMLElement | undefined;
  return !host?.hasAttribute('data-hidden');
}

function useRotatingPhrase(active: boolean): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % EXAMPLE_PHRASES.length), 3200);
    return () => clearInterval(timer);
  }, [active]);
  return EXAMPLE_PHRASES[index]!;
}

export interface AiSearchProps {
  variant: 'desktop' | 'mobile';
  autoFocus?: boolean;
  /** Bumped by the "/" shortcut to focus the input. */
  focusRequests?: Store<number>;
  onDismiss?: () => void;
}

export function AiSearch({ variant, autoFocus, focusRequests, onDismiss }: AiSearchProps) {
  const vehicle = vehicleTypeFor(location.pathname);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reload?: boolean }>();
  const [brands, setBrands] = useState<AutocompleteBrand[]>();
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const index = useMemo(() => (brands ? buildIndex(brands) : undefined), [brands]);
  const phrase = useRotatingPhrase(!open && !query);
  const listId = `wmp-ai-list-${variant}`;

  const loadBrands = () => {
    if (brands || vehicle !== 'car') return;
    getAutocomplete()
      .then(setBrands)
      .catch(() => undefined);
  };

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(
    () =>
      focusRequests?.subscribe(() => {
        // Only the variant that is actually on screen reacts to the shortcut.
        if (!isShown(rootRef.current)) return;
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    [focusRequests],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !event.composedPath().includes(rootRef.current)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const trimmed = query.trim();
  const suggestions = suggest(index, trimmed);
  const options: Option[] = [
    ...(trimmed ? [{ type: 'ai' as const, query: trimmed }] : []),
    ...suggestions.map((suggestion) => ({ type: 'suggestion' as const, suggestion })),
    ...(!trimmed ? recent.map((r) => ({ type: 'recent' as const, recent: r })) : []),
  ];

  const go = (url: string, text: string) => {
    saveRecent(vehicle, { url: new URL(url, location.origin).href, query: text });
    location.assign(url);
  };

  const runSearch = async (text: string) => {
    const q = text.trim();
    if (!q || busy) {
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    const exact = brands ? exactMatch(brands, q) : undefined;
    if (exact) return go(suggestionUrl(exact, q, new URL(location.href)), q);
    setBusy(true);
    setOpen(true);
    try {
      go(await getClient().genAiSearch(q, vehicle), q);
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof PxBlockedError
          ? { message: PX_MESSAGE, reload: true }
          : { message: e instanceof Error && e.message && !/^HTTP/.test(e.message) ? e.message : GENERIC_ERROR },
      );
    }
  };

  const choose = (option: Option) => {
    if (option.type === 'ai') void runSearch(option.query);
    else if (option.type === 'suggestion') go(suggestionUrl(option.suggestion, trimmed, new URL(location.href)), trimmed || option.suggestion.label);
    else location.assign(option.recent.url);
  };

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (!options.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + delta + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (open && option) choose(option);
      else void runSearch(query);
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else {
        inputRef.current?.blur();
        onDismiss?.();
      }
    }
  };

  const showPanel = open && (busy || !!error || options.length > 0 || !trimmed);
  const activeId = active >= 0 && active < options.length ? `${listId}-${active}` : undefined;

  return (
    <div class={`wmp-root wmp-ai wmp-ai--${variant}`} ref={rootRef}>
      <form
        class="wmp-ai__field"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(query);
        }}
      >
        <div class="wmp-ai__inner">
          <SparkleIcon size={18} class="wmp-ai__icon" />
          <input
            ref={inputRef}
            class="wmp-ai__input"
            type="text"
            value={query}
            disabled={busy}
            autoComplete="off"
            spellcheck={false}
            role="combobox"
            aria-label="Busca com IA: descreva o carro que você procura"
            aria-expanded={showPanel}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            onFocus={() => {
              setOpen(true);
              setRecent(readRecent(vehicle));
              loadBrands();
            }}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActive(-1);
              setError(undefined);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
          {!query && (
            <span class="wmp-ai__label" aria-hidden="true">
              Buscar por <strong key={phrase}>{phrase}</strong>
            </span>
          )}
          <button class="wmp-ai__submit" type="submit" aria-label="Buscar" disabled={busy}>
            {busy ? <Spinner size={16} /> : <SearchIcon size={16} />}
          </button>
        </div>
      </form>

      {showPanel && (
        <div class="wmp-ai__panel">
          {busy && (
            <div class="wmp-ai__status" role="status">
              <Spinner size={16} /> Entendendo sua busca…
            </div>
          )}
          {error && (
            <div class="wmp-ai__error" role="alert">
              <AlertIcon size={18} />
              <span>{error.message}</span>
              {error.reload && (
                <button type="button" class="wmp-ai__link" onClick={() => location.reload()}>
                  Recarregar
                </button>
              )}
            </div>
          )}
          {!busy && (
            <ul class="wmp-ai__list" id={listId} role="listbox" aria-label="Sugestões de busca">
              {options.map((option, i) => {
                const first = (type: Option['type']) => options.findIndex((o) => o.type === type) === i;
                return (
                  <Fragment key={`${option.type}-${i}`}>
                    {option.type === 'suggestion' && first('suggestion') && (
                      <li class="wmp-ai__section" role="presentation">
                        Marcas e modelos
                      </li>
                    )}
                    {option.type === 'recent' && first('recent') && (
                      <li class="wmp-ai__section" role="presentation">
                        Buscas recentes
                      </li>
                    )}
                    <li
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      class="wmp-ai__option"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => choose(option)}
                      onPointerMove={() => setActive(i)}
                    >
                      {option.type === 'ai' && (
                        <>
                          <span class="wmp-ai__badge wmp-ai__badge--ai">
                            <SparkleIcon size={16} />
                          </span>
                          <span class="wmp-ai__text">
                            Buscar com IA: <strong>“{option.query}”</strong>
                          </span>
                        </>
                      )}
                      {option.type === 'suggestion' && (
                        <>
                          <span class="wmp-ai__badge">
                            <CarIcon size={16} />
                          </span>
                          <span class="wmp-ai__text">
                            {option.suggestion.label}
                            <small>{option.suggestion.kind === 'make' ? 'Marca' : 'Modelo'}</small>
                          </span>
                        </>
                      )}
                      {option.type === 'recent' && (
                        <>
                          <span class="wmp-ai__badge">
                            <ClockIcon size={16} />
                          </span>
                          <span class="wmp-ai__text">{option.recent.query}</span>
                        </>
                      )}
                    </li>
                  </Fragment>
                );
              })}
              {!trimmed && !recent.length && (
                <li class="wmp-ai__hint" role="presentation">
                  Descreva o carro que você procura, como “{EXAMPLE_PHRASES[0]}”.
                </li>
              )}
            </ul>
          )}
          {variant === 'desktop' && !busy && (
            <p class="wmp-ai__footer">
              Pressione <kbd>/</kbd> para buscar de qualquer página
            </p>
          )}
        </div>
      )}
    </div>
  );
}
