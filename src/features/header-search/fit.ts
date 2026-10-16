/** How the header search fits: the full bar, the icon button (opens a sheet), or not at all. */
export type HeaderFit = 'full' | 'compact' | 'none';

const MARGIN = 16;
const COMPACT_MARGIN = 8;
/** Air left between our bar and the site's menu. */
const BREATHING = 16;
const MIN_WIDTH = 160;
const MAX_WIDTH = 360;
const COMPACT_WIDTH = 40;

/** Width an element needs: its children's extent (ignoring flex-grown space) plus its margins. */
function neededWidth(el: Element): number {
  const rects = [...el.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
  const content = rects.length
    ? Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left))
    : el.getBoundingClientRect().width;
  const style = getComputedStyle(el);
  return content + (Number.parseFloat(style.marginLeft) || 0) + (Number.parseFloat(style.marginRight) || 0);
}

/**
 * Sizes the header search to the space the site's header leaves free, so the
 * menu is never squeezed or overlapped; falls back to an icon button when the
 * bar does not fit. Sizing goes through CSS variables because the shadow
 * host's `:host` rules win over inline `!important` styles.
 */
export function fitIntoHeader(host: HTMLElement, onFit: (fit: HeaderFit) => void): () => void {
  const row = host.parentElement;
  if (!row) return () => undefined;

  const set = (fit: HeaderFit, width: number, margin: number) => {
    host.toggleAttribute('data-no-room', fit === 'none');
    host.style.setProperty('--wmp-fit-width', `${width}px`);
    host.style.setProperty('--wmp-fit-margin', `${margin}px`);
    onFit(fit);
  };

  const fit = () => {
    // Measure the site's header without us in it.
    host.style.setProperty('--wmp-fit-width', '0px');
    host.style.setProperty('--wmp-fit-margin', '0px');
    let used = 0;
    for (const child of row.children) if (child !== host) used += neededWidth(child);
    const style = getComputedStyle(row);
    const free =
      row.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0) - used;
    const width = Math.min(MAX_WIDTH, Math.floor(free - 2 * MARGIN - BREATHING));
    if (width >= MIN_WIDTH) set('full', width, MARGIN);
    else if (free - 2 * COMPACT_MARGIN - BREATHING >= COMPACT_WIDTH) set('compact', COMPACT_WIDTH, COMPACT_MARGIN);
    else set('none', 0, 0);
  };

  // A short timer rather than an animation frame: frames pause in minimized windows.
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(fit, 30);
  };
  fit();
  // The row follows the window; its content changes when the user name, fonts
  // or menus load after us.
  const resize = new ResizeObserver(schedule);
  resize.observe(row);
  window.addEventListener('resize', schedule);
  const mutations = new MutationObserver(schedule);
  mutations.observe(row, { childList: true, subtree: true, characterData: true });
  void document.fonts?.ready.then(schedule);
  return () => {
    resize.disconnect();
    mutations.disconnect();
    window.removeEventListener('resize', schedule);
    clearTimeout(timer);
  };
}
