export function waitForElement<T extends Element = Element>(
  selector: string,
  { timeout = 15_000, root = document, signal }: { timeout?: number; root?: ParentNode; signal?: AbortSignal } = {},
): Promise<T | null> {
  const found = root.querySelector<T>(selector);
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const el = root.querySelector<T>(selector);
      if (el) finish(el);
    });
    const timer = setTimeout(() => finish(null), timeout);
    const finish = (value: T | null) => {
      observer.disconnect();
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    signal?.addEventListener('abort', onAbort, { once: true });
    observer.observe(root === document ? document.documentElement : (root as Node), { childList: true, subtree: true });
  });
}

export function whenLoaded(): Promise<void> {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }));
}

export function whenIdle(timeout = 2000): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 50);
  });
}

/** After the page has loaded and hydrated (safe to inject into React-owned DOM). */
export async function whenHydrated(): Promise<void> {
  await whenLoaded();
  await whenIdle();
}

export function injectStyle(id: string, css: string): void {
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    (document.head ?? document.documentElement).appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

export function setRootFlag(name: string, value: string | null): void {
  const root = document.documentElement;
  if (value === null) root.removeAttribute(name);
  else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
}
