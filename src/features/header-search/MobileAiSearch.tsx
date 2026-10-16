import { useEffect, useRef, useState } from 'preact/hooks';
import type { Store } from '../../lib/store';
import { CloseIcon, SparkleIcon } from '../../ui/icons';
import { AiSearch, isShown } from './AiSearch';

/** Header icon (narrow layouts) that opens the AI search in a sheet below the header. */
export function MobileAiSearch({ focusRequests }: { focusRequests?: Store<number> }) {
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(64);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openSheet = () => {
    const header = triggerRef.current?.closest('header') ?? document.querySelector('header');
    setTop(Math.max(0, header?.getBoundingClientRect().bottom ?? 64));
    setOpen(true);
  };

  useEffect(
    () =>
      focusRequests?.subscribe(() => {
        if (isShown(triggerRef.current)) openSheet();
      }),
    [focusRequests],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div class="wmp-root wmp-mai">
      <button
        ref={triggerRef}
        type="button"
        class="wmp-mai__trigger"
        aria-label="Busca com IA"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openSheet())}
      >
        <SparkleIcon size={20} />
      </button>
      {open && (
        <>
          <div class="wmp-mai__scrim" style={{ top: `${top}px` }} onClick={() => setOpen(false)} />
          <div class="wmp-mai__sheet" style={{ top: `${top}px` }} role="dialog" aria-label="Busca com IA">
            <AiSearch variant="mobile" autoFocus onDismiss={() => setOpen(false)} />
            <button type="button" class="wmp-mai__close" aria-label="Fechar busca" onClick={() => setOpen(false)}>
              <CloseIcon size={20} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
