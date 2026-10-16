import { type Store, useStore } from '../../lib/store';
import { AiSearch } from './AiSearch';
import type { HeaderFit } from './fit';
import { MobileAiSearch } from './MobileAiSearch';

/** The search in the desktop header: the full bar, or an icon button when the menu leaves too little room. */
export function DesktopAiSearch({ fit, focusRequests }: { fit: Store<HeaderFit>; focusRequests: Store<number> }) {
  const mode = useStore(fit);
  if (mode === 'none') return null;
  if (mode === 'compact') return <MobileAiSearch focusRequests={focusRequests} />;
  return <AiSearch variant="desktop" focusRequests={focusRequests} />;
}
