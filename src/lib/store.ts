import { useEffect, useState } from 'preact/hooks';

/** Minimal observable value shared between the extension's Preact roots. */
export class Store<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  update(fn: (value: T) => T): void {
    this.set(fn(this.value));
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(() => store.get());
  useEffect(() => {
    setValue(store.get());
    return store.subscribe(setValue);
  }, [store]);
  return value;
}
