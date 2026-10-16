import '../../features/search-page/style.css';
import { render, type VNode } from 'preact';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { ContentScriptAppendMode } from 'wxt/utils/content-script-ui/types';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { isBlacklistEmpty } from '../../features/blacklist/blacklist';
import { BlacklistSection } from '../../features/blacklist/BlacklistSection';
import { FilteredResults } from '../../features/blacklist/FilteredResults';
import { FILTERED_FLAG, SearchPageApp } from '../../features/search-page/app';
import { watchLayout } from '../../features/search-page/layout';
import { PAGE_CSS } from '../../features/search-page/page-styles';
import { TreeDock, TreeDrawer } from '../../features/tree/TreeDock';
import { IDLE_START_DELAY_MS } from '../../lib/config';
import { injectStyle, setRootFlag, waitForElement, whenHydrated, whenIdle, whenLoaded } from '../../lib/dom';
import { SEL } from '../../lib/selectors';
import { parseSearchUrl } from '../../lib/webmotors/search-url';

/**
 * Results page (`/carros/...`): brand/model blacklist, extension-rendered
 * filtered results and the right-side tree panel.
 */
export default defineContentScript({
  matches: ['https://www.webmotors.com.br/carros/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  async main(ctx) {
    // Before the page renders: hide the native list if this search has a blacklist.
    injectStyle('wmp-page-styles', PAGE_CSS);
    if (!isBlacklistEmpty(parseSearchUrl(location.href).blacklist)) setRootFlag(FILTERED_FLAG, '');

    await whenHydrated();
    const layout = await waitForElement(SEL.layoutContainer, { timeout: 15_000, signal: ctx.signal });
    if (!layout) {
      // Not a results page (or the layout changed): never leave the native list hidden.
      setRootFlag(FILTERED_FLAG, null);
      return;
    }

    const app = new SearchPageApp(location.href);
    app.start(ctx.signal);
    watchLayout(app.panelOpen, ctx.signal);

    await mount(ctx, 'wmp-blacklist', SEL.filtersMakeSection, 'after', <BlacklistSection app={app} />);
    const results = await mount(ctx, 'wmp-results', SEL.resultsMain, 'after', <FilteredResults app={app} />);
    await mount(ctx, 'wmp-tree-panel', SEL.layoutAside, 'first', <TreeDock app={app} />);
    await mount(ctx, 'wmp-tree-drawer', 'body', 'last', <TreeDrawer app={app} />);
    if (!results) setRootFlag(FILTERED_FLAG, null);

    // Filtered results replace visible content: start right after load.
    await whenLoaded();
    app.enableResults();

    // The tree is secondary: wait until the page's own requests have settled.
    await whenIdle(4000);
    ctx.setTimeout(() => app.enableTree(), IDLE_START_DELAY_MS);
  },
});

async function mount(
  ctx: ContentScriptContext,
  name: string,
  anchor: string,
  append: ContentScriptAppendMode,
  view: VNode,
): Promise<boolean> {
  if (!(await waitForElement(anchor, { timeout: 10_000, signal: ctx.signal }))) return false;
  const ui = await createShadowRootUi(ctx, {
    name,
    position: 'inline',
    anchor,
    append,
    isolateEvents: true,
    onMount(container) {
      render(view, container);
      return container;
    },
    onRemove: (container) => container && render(null, container),
  });
  ui.autoMount();
  return true;
}
