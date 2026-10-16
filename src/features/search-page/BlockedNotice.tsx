import { useEffect, useState } from 'preact/hooks';
import { AlertIcon } from '../../ui/icons';
import type { SearchPageApp } from './app';

/** Shown while Webmotors' bot protection asks us to pause; retries on its own. */
export function BlockedNotice({ app, until }: { app: SearchPageApp; until?: number }) {
  const [now, setNow] = useState(Date.now());
  const remaining = Math.max(0, Math.ceil(((until ?? 0) - now) / 1000));

  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);

  useEffect(() => {
    if (until && remaining === 0) void app.retryNow();
  }, [remaining === 0]);

  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, '0');

  return (
    <div class="wmp-notice" role="status">
      <AlertIcon size={18} />
      <span>
        A Webmotors limitou temporariamente as consultas.
        {remaining > 0 && ` Tentaremos de novo em ${minutes}:${seconds}.`}
      </span>
      <button type="button" class="wmp-link" onClick={() => void app.retryNow()}>
        Tentar agora
      </button>
    </div>
  );
}
