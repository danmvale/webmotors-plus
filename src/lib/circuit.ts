import { storage } from 'wxt/utils/storage';

/**
 * Shared pause after a bot-protection block. Lives in `storage.local` so every
 * tab (and the service worker after a restart) sees the same state.
 */
export const circuitItem = storage.defineItem<{ openUntil: number }>('local:wmCircuit', {
  fallback: { openUntil: 0 },
});

let cached = 0;
let watching = false;

/** Keeps a synchronous copy for the request scheduler; returns an unwatch function. */
export function watchCircuit(onChange?: (openUntil: number) => void): () => void {
  void circuitItem.getValue().then((v) => {
    cached = v.openUntil;
    onChange?.(cached);
  });
  watching = true;
  const unwatch = circuitItem.watch((v) => {
    cached = v?.openUntil ?? 0;
    onChange?.(cached);
  });
  return () => {
    watching = false;
    unwatch();
  };
}

export function circuitOpenUntil(): number | undefined {
  if (!watching) return undefined;
  return cached > Date.now() ? cached : undefined;
}

export function setCircuitLocally(openUntil: number): void {
  cached = openUntil;
}
