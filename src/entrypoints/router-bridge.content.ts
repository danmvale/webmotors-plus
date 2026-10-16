import { defineContentScript } from 'wxt/utils/define-content-script';
import { BRIDGE_READY_ATTR, NAVIGATE_EVENT } from '../lib/bridge';

interface NextRouter {
  push(url: string, as?: string, options?: { shallow?: boolean; scroll?: boolean }): Promise<boolean>;
}

/**
 * Runs in the page's MAIN world: navigates through Next.js' router, as the
 * site's own filters do. It patches nothing on the page (URL changes are
 * observed with the Navigation API from the isolated world instead).
 */
export default defineContentScript({
  matches: ['https://www.webmotors.com.br/carros/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    window.addEventListener(NAVIGATE_EVENT, (event) => {
      let url: unknown;
      try {
        url = (JSON.parse(String((event as CustomEvent).detail)) as { url?: unknown }).url;
      } catch {
        return;
      }
      // Only ever navigate to search pages on this site.
      if (typeof url !== 'string' || !url.startsWith('/carros/')) return;
      const router = (window as unknown as { next?: { router?: NextRouter } }).next?.router;
      if (!router?.push) {
        window.location.assign(url);
        return;
      }
      router.push(url, undefined, { shallow: true, scroll: false }).catch(() => window.location.assign(url));
    });

    document.documentElement.setAttribute(BRIDGE_READY_ATTR, '1');
  },
});
