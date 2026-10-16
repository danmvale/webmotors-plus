/**
 * Isolated-world side of the router bridge (see entrypoints/router-bridge.content.ts).
 * Navigating through Next's router keeps the SPA state, chips and results in sync,
 * exactly like the site's own filter changes.
 */
export const NAVIGATE_EVENT = 'wmp:navigate';
export const BRIDGE_READY_ATTR = 'data-wmp-bridge';

export function navigate(url: string): void {
  if (document.documentElement.hasAttribute(BRIDGE_READY_ATTR)) {
    window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: JSON.stringify({ url }) }));
  } else {
    window.location.assign(url);
  }
}

/** Chrome's Navigation API (not in every TypeScript DOM lib yet). */
interface NavigationLike extends EventTarget {
  readonly currentEntry: unknown;
}

/**
 * Calls `cb` whenever the URL changes (SPA pushes, replaces, back/forward).
 * The Navigation API reports `history.pushState` without patching it.
 */
export function onLocationChange(cb: (href: string) => void, signal: AbortSignal): void {
  let last = location.href;
  const check = () => {
    if (location.href === last) return;
    last = location.href;
    cb(last);
  };
  const navigation = (window as unknown as { navigation?: NavigationLike }).navigation;
  navigation?.addEventListener('currententrychange', check, { signal });
  window.addEventListener('popstate', check, { signal });
  // Safety net in case the bridge is unavailable.
  const timer = setInterval(check, 1000);
  signal.addEventListener('abort', () => clearInterval(timer), { once: true });
}
