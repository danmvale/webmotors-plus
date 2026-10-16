import { setRootFlag } from '../../lib/dom';
import type { Store } from '../../lib/store';
import { SEL } from '../../lib/selectors';

/** Set on <html> while the page is widened for the docked panel. */
export const WIDE_FLAG = 'data-wmp-wide';

/** Preferred panel width first; narrower ones are tried before giving up a card column. */
const PANEL_WIDTHS = [320, 300, 280];
/** The site's own right column (ad skyscraper) the panel replaces. */
const NATIVE_ASIDE = 160;
/** Minimum side margin left when widening the page. */
const GUTTER = 24;
/** Sub-pixel safety so the last card of a row never wraps. */
const SLACK = 4;
/** Below this the site hides its right column (the panel becomes a drawer). */
const DOCKED_MIN_VIEWPORT = 1072;

export interface LayoutMetrics {
  /** Native width of the results layout (filters + results + right column). */
  container: number;
  viewport: number;
  /** Filters column plus both grid gaps. */
  fixed: number;
  card: number;
  gap: number;
}

export interface LayoutPlan {
  /** Width to give the page's content, if it must grow. */
  pageWidth?: number;
  panelWidth: number;
}

/**
 * Keeps as many result cards per row as the site shows without the extension:
 * the page grows into its side margins by what the panel takes beyond the
 * native 160 px column, and the panel narrows a little before a column is lost.
 */
export function planLayout(m: LayoutMetrics): LayoutPlan {
  const step = m.card + m.gap;
  const columns = Math.max(1, Math.floor((m.container - m.fixed - NATIVE_ASIDE + m.gap) / step));
  const results = columns * step - m.gap + SLACK;
  const max = m.viewport - 2 * GUTTER;
  for (const panel of PANEL_WIDTHS) {
    const needed = Math.ceil(results + m.fixed + panel);
    if (needed <= m.container) return { panelWidth: panel };
    if (needed <= max) return { pageWidth: needed, panelWidth: panel };
  }
  return { panelWidth: PANEL_WIDTHS[0]! };
}

function measure(): LayoutMetrics | undefined {
  const container = document.querySelector(SEL.layoutContainer);
  const search = document.querySelector(SEL.layoutSearch);
  if (!container || !search) return undefined;
  const containerStyle = getComputedStyle(container);
  const filters = Number.parseFloat(containerStyle.gridTemplateColumns.split(' ')[0] ?? '') || 340;
  const gaps =
    (Number.parseFloat(containerStyle.columnGap) || 0) + (Number.parseFloat(getComputedStyle(search).columnGap) || 0);
  const results = document.querySelector(SEL.resultsMain);
  return {
    container: container.getBoundingClientRect().width,
    viewport: document.documentElement.clientWidth,
    fixed: filters + gaps,
    // The native list is hidden while a blacklist is active: fall back to the known card size.
    card: document.querySelector(SEL.resultCard)?.getBoundingClientRect().width || 244,
    gap: (results && Number.parseFloat(getComputedStyle(results).columnGap)) || 12,
  };
}

/** Re-plans the page width whenever the panel opens/closes or the window resizes. */
export function watchLayout(panelOpen: Store<boolean>, signal: AbortSignal): void {
  const root = document.documentElement;
  const apply = () => {
    // Measure the site's own layout first.
    setRootFlag(WIDE_FLAG, null);
    root.style.removeProperty('--wmp-page-width');
    root.style.removeProperty('--wmp-panel-width');
    if (!panelOpen.get() || root.clientWidth < DOCKED_MIN_VIEWPORT) return;
    const metrics = measure();
    if (!metrics) return;
    const plan = planLayout(metrics);
    root.style.setProperty('--wmp-panel-width', `${plan.panelWidth}px`);
    if (plan.pageWidth) {
      root.style.setProperty('--wmp-page-width', `${plan.pageWidth}px`);
      setRootFlag(WIDE_FLAG, '');
    }
  };

  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  apply();
  window.addEventListener('resize', schedule, { signal });
  // Opening/closing must not leave a frame with the panel and the page out of step.
  const unsubscribe = panelOpen.subscribe(() => {
    cancelAnimationFrame(frame);
    apply();
  });
  signal.addEventListener(
    'abort',
    () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      setRootFlag(WIDE_FLAG, null);
      root.style.removeProperty('--wmp-page-width');
      root.style.removeProperty('--wmp-panel-width');
    },
    { once: true },
  );
}
