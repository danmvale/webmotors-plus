import '../../features/header-search/style.css';
import { render } from 'preact';
import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { DesktopAiSearch } from '../../features/header-search/DesktopAiSearch';
import { fitIntoHeader, type HeaderFit } from '../../features/header-search/fit';
import { MobileAiSearch } from '../../features/header-search/MobileAiSearch';
import { waitForElement, whenHydrated } from '../../lib/dom';
import { sendMessage } from '../../lib/messaging';
import { SEL } from '../../lib/selectors';
import { Store } from '../../lib/store';
import { isCaptchaPage } from '../../lib/webmotors/px';

/**
 * Natural-language (AI) search in the site header, on every page. The site
 * only offers it on the homepage hero.
 */
export default defineContentScript({
  matches: ['https://www.webmotors.com.br/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    if (import.meta.env.MODE === 'development') {
      window.addEventListener('wmp:dev-reload', () => void browser.runtime.sendMessage({ type: 'dev:reload' }));
    }
    await whenHydrated();
    if (isCaptchaPage()) {
      // The site is challenging this browser: pause the extension's requests in every tab.
      void sendMessage('wm:blocked').catch(() => undefined);
      return;
    }
    if (!document.querySelector('header')) await waitForElement('header', { timeout: 10_000, signal: ctx.signal });

    const focusRequests = new Store(0);
    const isHome = location.pathname === '/' || location.pathname === '';

    const desktop = await createShadowRootUi(ctx, {
      name: 'wmp-ai-search',
      position: 'inline',
      anchor: DESKTOP_ANCHOR,
      append: 'after',
      isolateEvents: true,
      onMount(container, _shadow, host) {
        const fit = new Store<HeaderFit>('full');
        const stopFitting = fitIntoHeader(host, (mode) => fit.set(mode));
        render(<DesktopAiSearch fit={fit} focusRequests={focusRequests} />, container);
        if (isHome) hideWhileVisible(ctx, host, SEL.homeAiSearch);
        return { container, stopFitting };
      },
      onRemove: (mounted) => {
        mounted?.stopFitting();
        if (mounted) render(null, mounted.container);
      },
    });
    desktop.autoMount();

    const mobile = await createShadowRootUi(ctx, {
      name: 'wmp-ai-search-mobile',
      position: 'inline',
      anchor: MOBILE_ANCHOR,
      append: 'before',
      isolateEvents: true,
      onMount(container, _shadow, host) {
        render(<MobileAiSearch focusRequests={focusRequests} />, container);
        if (isHome) hideWhileVisible(ctx, host, SEL.homeAiSearchMobile);
        return container;
      },
      onRemove: (container) => container && render(null, container),
    });
    mobile.autoMount();

    ctx.addEventListener(document, 'keydown', (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.composedPath()[0])) return;
      event.preventDefault();
      focusRequests.set(focusRequests.get() + 1);
    });
  },
});

/** Headers that do not already carry the site's own AI search (A/B tests). */
const HEADER_WITHOUT_AI = `header:not(:has(${SEL.homeAiSearch}, ${SEL.headerNativeAiSlot} input))`;
/** The logo's wrapper in the desktop header; our bar goes right after it. */
const DESKTOP_ANCHOR = `${HEADER_WITHOUT_AI} :has(> ${SEL.headerDesktopLogo})`;
/** The hamburger in the mobile header; our icon button goes right before it. */
const MOBILE_ANCHOR = `${HEADER_WITHOUT_AI} ${SEL.headerMobileMenuToggle}`;

/** On the homepage, show the header bar only once the hero search scrolls away. */
function hideWhileVisible(ctx: ContentScriptContext, host: HTMLElement, heroSelector: string): void {
  host.setAttribute('data-hidden', '');
  void waitForElement(heroSelector, { timeout: 10_000, signal: ctx.signal }).then((hero) => {
    if (!hero) {
      host.removeAttribute('data-hidden');
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      host.toggleAttribute('data-hidden', !!entry?.isIntersecting);
    });
    observer.observe(hero);
    ctx.onInvalidated(() => observer.disconnect());
  });
}

function isEditable(target: EventTarget | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
