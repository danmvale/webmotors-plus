import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatBRL, formatInt, plural, vehicleName } from '../../lib/format';
import { useStore } from '../../lib/store';
import { nameKey } from '../../lib/webmotors/slug';
import { isTargetApplied, type SearchState, type TreeTarget } from '../../lib/webmotors/search-url';
import { AlertIcon, CheckIcon, ChevronIcon, CloseIcon, SearchIcon, Spinner, TreeIcon } from '../../ui/icons';
import { BlockedNotice } from '../search-page/BlockedNotice';
import type { SearchPageApp } from '../search-page/app';
import type { VersionAgg } from './aggregate';
import { type FipeCell, type MakeNode, type ModelNode, pathKey, type TreeController, type YearNode } from './controller';

export interface TreePanelProps {
  app: SearchPageApp;
  variant: 'docked' | 'drawer';
  onClose: () => void;
}

/** "Explorar resultados": Marca › Modelo (n) › Ano › Versão — FIPE | Preço médio. */
export function TreePanel({ app, variant, onClose }: TreePanelProps) {
  const state = useStore(app.tree.state);
  const search = useStore(app.search);
  const [filter, setFilter] = useState('');
  const treeRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const q = nameKey(filter);

  // The docked panel is mounted but hidden on narrow windows: load only once it is visible.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(() => {
      if (panel.getClientRects().length) app.showTree();
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [app]);

  const makes = useMemo(() => {
    if (!q) return state.makes;
    return state.makes
      .map((make) => {
        if (nameKey(make.name).includes(q)) return make;
        const models = make.models?.filter((m) => nameKey(`${make.name} ${m.name}`).includes(q) || nameKey(m.name).includes(q));
        return models?.length ? { ...make, models } : null;
      })
      .filter((m): m is MakeNode => m !== null);
  }, [state.makes, q]);

  const onTreeKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLUListElement>) => {
    const items = [...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"] > .wmp-tree__row .wmp-tree__label') ?? [])];
    const index = items.indexOf(event.target as HTMLElement);
    if (index === -1) return;
    const row = (event.target as HTMLElement).closest('[role="treeitem"]') as HTMLElement;
    const toggle = row.querySelector<HTMLButtonElement>(':scope > .wmp-tree__row .wmp-tree__toggle');
    const expanded = row.getAttribute('aria-expanded') === 'true';
    const focus = (i: number) => items[Math.max(0, Math.min(items.length - 1, i))]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        focus(index + 1);
        break;
      case 'ArrowUp':
        focus(index - 1);
        break;
      case 'ArrowRight':
        if (toggle && !expanded) toggle.click();
        else focus(index + 1);
        break;
      case 'ArrowLeft':
        if (toggle && expanded) toggle.click();
        else (row.parentElement?.closest('[role="treeitem"]')?.querySelector('.wmp-tree__label') as HTMLElement | null)?.focus();
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(items.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <aside ref={panelRef} class={`wmp-root wmp-panel wmp-panel--${variant}`} aria-label="Explorar resultados">
      <header class="wmp-panel__header">
        <div class="wmp-panel__titles">
          <h2 class="wmp-panel__title">
            <TreeIcon size={18} /> Explorar resultados
          </h2>
          <p class="wmp-panel__subtitle">
            {state.total !== undefined ? (
              <>
                {plural(state.total, 'anúncio', 'anúncios')} · {plural(state.makes.length, 'marca', 'marcas')}
              </>
            ) : (
              'Analisando a busca completa…'
            )}
          </p>
        </div>
        <button type="button" class="wmp-icon-btn" aria-label={variant === 'drawer' ? 'Fechar' : 'Recolher painel'} onClick={onClose}>
          {variant === 'drawer' ? <CloseIcon size={18} /> : <ChevronIcon size={18} />}
        </button>
      </header>

      {state.progress && (
        <div class="wmp-panel__progress" role="status">
          <div class="wmp-progress">
            <span style={{ width: `${Math.min(100, (100 * state.progress.loaded) / Math.max(1, state.progress.total))}%` }} />
          </div>
          <small>
            Analisando {formatInt(state.progress.loaded)} de {formatInt(state.progress.total)} anúncios
          </small>
        </div>
      )}

      {state.makes.length > 8 && (
        <label class="wmp-panel__filter">
          <SearchIcon size={16} />
          <input
            type="search"
            placeholder="Filtrar marca ou modelo"
            value={filter}
            onInput={(e) => setFilter(e.currentTarget.value)}
            aria-label="Filtrar marca ou modelo"
          />
        </label>
      )}

      <div class="wmp-panel__body">
        {state.status === 'blocked' && <BlockedNotice app={app} until={state.blockedUntil} />}
        {state.status === 'error' && (
          <div class="wmp-notice" role="alert">
            <AlertIcon size={18} />
            <span>{state.error}</span>
            <button type="button" class="wmp-link" onClick={() => app.tree.retry()}>
              Tentar novamente
            </button>
          </div>
        )}
        {state.status === 'loading' && !state.makes.length && <TreeSkeleton />}
        {state.status === 'ready' && !state.makes.length && <p class="wmp-panel__empty">Nenhum anúncio nesta busca.</p>}
        {q && !makes.length && state.makes.length > 0 && <p class="wmp-panel__empty">Nada encontrado para “{filter}”.</p>}

        {makes.length > 0 && (
          <ul class="wmp-tree" role="tree" aria-label="Marcas, modelos, anos e versões" ref={treeRef} onKeyDown={onTreeKeyDown}>
            {makes.map((make) => (
              <MakeRow key={make.name} app={app} make={make} search={search} forceOpen={!!q} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function useExpanded(controller: TreeController, key: string): boolean {
  return useStore(controller.expanded).has(key);
}

interface RowProps {
  app: SearchPageApp;
  search: SearchState;
}

function MakeRow({ app, make, search, forceOpen }: RowProps & { make: MakeNode; forceOpen: boolean }) {
  const key = pathKey(make.name);
  const expanded = useExpanded(app.tree, key) || (forceOpen && !!make.models);
  const target = { make: make.name };
  return (
    <li role="treeitem" aria-expanded={expanded} aria-level={1} class="wmp-tree__item">
      <Row
        level={1}
        expanded={expanded}
        loading={make.status === 'loading'}
        onToggle={() => app.tree.toggle(key, { kind: 'make', make: make.name })}
        label={vehicleName(make.name)}
        applied={isTargetApplied(search, target)}
        onApply={() => app.applyTreeTarget(target)}
        applyHint={`Filtrar por ${vehicleName(make.name)}`}
      />
      {expanded && make.status === 'error' && <RowError onRetry={() => app.tree.toggle(key, { kind: 'make', make: make.name })} />}
      {expanded && make.models && (
        <ul role="group" class="wmp-tree__group">
          {make.models.map((model) => (
            <ModelRow key={model.name} app={app} search={search} make={make.name} model={model} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ModelRow({ app, search, make, model }: RowProps & { make: string; model: ModelNode }) {
  const key = pathKey(make, model.name);
  const expanded = useExpanded(app.tree, key);
  const target = { make, model: model.name };
  return (
    <li role="treeitem" aria-expanded={expanded} aria-level={2} class="wmp-tree__item">
      <Row
        level={2}
        expanded={expanded}
        loading={model.status === 'loading'}
        onToggle={() => app.tree.toggle(key, { kind: 'model', make, model: model.name })}
        label={vehicleName(model.name)}
        meta={`(${formatInt(model.count)})`}
        applied={isTargetApplied(search, target)}
        onApply={() => app.applyTreeTarget(target)}
        applyHint={`Filtrar por ${vehicleName(make)} ${vehicleName(model.name)}`}
      />
      {expanded && model.status === 'error' && (
        <RowError onRetry={() => app.tree.toggle(key, { kind: 'model', make, model: model.name })} />
      )}
      {expanded && model.years && (
        <ul role="group" class="wmp-tree__group">
          {model.partial && (
            <li class="wmp-tree__note" role="presentation">
              Dados parciais: a Webmotors limita a análise a 10.000 anúncios por ano.
            </li>
          )}
          {model.years.map((year) => (
            <YearRow key={year.year} app={app} search={search} make={make} model={model.name} year={year} />
          ))}
        </ul>
      )}
    </li>
  );
}

function YearRow({ app, search, make, model, year }: RowProps & { make: string; model: string; year: YearNode }) {
  const key = pathKey(make, model, year.year);
  const expanded = useExpanded(app.tree, key);
  const toggle = () => app.tree.toggle(key, { kind: 'year', make, model, year });
  return (
    <li role="treeitem" aria-expanded={expanded} aria-level={3} class="wmp-tree__item">
      <Row
        level={3}
        expanded={expanded}
        loading={year.status === 'loading'}
        onToggle={toggle}
        label={String(year.year)}
        meta={`(${formatInt(year.count)})`}
      />
      {expanded && year.status === 'error' && <RowError onRetry={() => app.tree.retryYear(make, model, year.year)} />}
      {expanded && year.versions.length > 0 && (
        <ul role="group" class="wmp-tree__group">
          {year.versions.map((version) => (
            <VersionRow key={version.name} app={app} search={search} make={make} model={model} year={year.year} version={version} />
          ))}
        </ul>
      )}
    </li>
  );
}

function VersionRow({ app, search, make, model, year, version }: RowProps & { make: string; model: string; year: number; version: VersionAgg }) {
  const target = { make, model, version: version.name };
  const fipe = useStore(app.tree.fipe).get(pathKey(make, model, year, version.name));
  const applied = isTargetApplied(search, target);
  return (
    <li role="treeitem" aria-level={4} class="wmp-tree__item">
      <div class={`wmp-tree__row wmp-tree__row--leaf${applied ? ' wmp-tree__row--applied' : ''}`} style="--level:4">
        <span class="wmp-tree__spacer" />
        <button
          type="button"
          class="wmp-tree__label wmp-tree__label--version"
          title={`${version.name} — filtrar por esta versão`}
          aria-current={applied || undefined}
          tabIndex={-1}
          onClick={() => app.applyTreeTarget(target)}
        >
          <span class="wmp-tree__name">
            {applied && <CheckIcon size={14} />}
            {version.name.toLowerCase()} <span class="wmp-tree__meta">({formatInt(version.count)})</span>
          </span>
          {/* One line when it fits, stacked otherwise; the separator hides at line starts. */}
          <span class="wmp-tree__prices">
            <span class="wmp-tree__prices-row">
              <span class="wmp-tree__price">
                <FipeValue cell={fipe} implied={version.implied} />
              </span>
              <span class="wmp-tree__price">
                Preço médio: <strong>{version.avgPrice ? formatBRL(version.avgPrice) : '—'}</strong>
              </span>
            </span>
          </span>
        </button>
      </div>
    </li>
  );
}

function FipeValue({ cell, implied }: { cell: FipeCell | undefined; implied?: number }) {
  if (cell?.status === 'done') {
    const r = cell.result;
    if (r.confidence === 'approximate') {
      return (
        <span title={`Versão mais próxima na FIPE: ${r.label} (${r.code}) · ${r.month}`}>
          FIPE: <strong>≈ {formatBRL(r.value)}</strong>
        </span>
      );
    }
    return (
      <span title={`FIPE ${r.code} · ${r.label} · ${r.month}`}>
        FIPE: <strong>{formatBRL(r.value)}</strong>
      </span>
    );
  }
  if (implied && cell?.status !== 'loading') {
    return (
      <span title="Estimativa a partir do % da FIPE informado pela Webmotors">
        FIPE: <strong>≈ {formatBRL(implied)}</strong>
      </span>
    );
  }
  if (cell?.status === 'loading') {
    return (
      <span>
        FIPE: <span class="wmp-skeleton wmp-tree__price-skeleton" aria-label="carregando" />
      </span>
    );
  }
  return (
    <span title="Valor FIPE não encontrado para esta versão">
      FIPE: <strong>—</strong>
    </span>
  );
}

interface RowViewProps {
  level: number;
  expanded: boolean;
  loading?: boolean;
  onToggle: () => void;
  label: string;
  meta?: string;
  applied?: boolean;
  onApply?: () => void;
  applyHint?: string;
}

function Row({ level, expanded, loading, onToggle, label, meta, applied, onApply, applyHint }: RowViewProps) {
  return (
    <div class={`wmp-tree__row${applied ? ' wmp-tree__row--applied' : ''}`} style={`--level:${level}`}>
      <button
        type="button"
        class="wmp-tree__toggle"
        tabIndex={-1}
        aria-label={expanded ? `Recolher ${label}` : `Expandir ${label}`}
        onClick={onToggle}
      >
        {loading ? <Spinner size={14} /> : <ChevronIcon size={14} class={expanded ? 'wmp-rot' : undefined} />}
      </button>
      <button
        type="button"
        class="wmp-tree__label"
        tabIndex={level === 1 ? 0 : -1}
        title={onApply ? applyHint : undefined}
        aria-current={applied || undefined}
        onClick={onApply ?? onToggle}
      >
        <span class="wmp-tree__name">
          {applied && <CheckIcon size={14} />}
          {label} {meta && <span class="wmp-tree__meta">{meta}</span>}
        </span>
      </button>
    </div>
  );
}

function RowError({ onRetry }: { onRetry: () => void }) {
  return (
    <div class="wmp-tree__error">
      Não foi possível carregar.{' '}
      <button type="button" class="wmp-link" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}

function TreeSkeleton() {
  return (
    <div class="wmp-tree__skeleton" aria-hidden="true">
      {[70, 55, 80, 60, 45, 65].map((w, i) => (
        <span key={i} class="wmp-skeleton" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export type { TreeTarget };
