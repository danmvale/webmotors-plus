import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../../lib/store';
import { ChevronIcon, TreeIcon } from '../../ui/icons';
import type { SearchPageApp } from '../search-page/app';
import { TreePanel } from './TreePanel';

/** Docked in the site's right column (≥ 1072 px); collapses to a compact card. */
export function TreeDock({ app }: { app: SearchPageApp }) {
  const open = useStore(app.panelOpen);
  if (!open) {
    return (
      <button type="button" class="wmp-root wmp-dock-collapsed" onClick={() => app.setPanelOpen(true)}>
        <span class="wmp-dock-collapsed__icon">
          <TreeIcon size={18} />
        </span>
        <span class="wmp-dock-collapsed__text">
          <strong>Explorar resultados</strong>
          <small>Modelos, anos, FIPE e preço médio</small>
        </span>
        <ChevronIcon size={16} class="wmp-dock-collapsed__chevron" />
      </button>
    );
  }
  return <TreePanel app={app} variant="docked" onClose={() => app.setPanelOpen(false)} />;
}

/** Narrow windows (the site hides its right column): floating button + drawer. */
export function TreeDrawer({ app }: { app: SearchPageApp }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = overflow;
    };
  }, [open]);

  return (
    <div class="wmp-root">
      {!open && (
        <button type="button" class="wmp-fab" onClick={() => setOpen(true)}>
          <TreeIcon size={18} /> Explorar resultados
        </button>
      )}
      {open && (
        <>
          <div class="wmp-drawer__scrim" onClick={() => setOpen(false)} />
          <div class="wmp-drawer" role="dialog" aria-modal="true" aria-label="Explorar resultados">
            <TreePanel app={app} variant="drawer" onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
