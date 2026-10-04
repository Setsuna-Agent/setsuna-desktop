import { useCallback, useEffect, useState } from 'react';
import type { BrowserRecordsKind } from './BrowserRecordsManager.js';

export function useBrowserRecordsPanel(hidden: boolean) {
  const [kind, setKind] = useState<BrowserRecordsKind | null>(null);
  const [pinned, setPinned] = useState(false);
  const close = useCallback(() => setKind(null), []);
  // A floating portal cannot stay visible when its browser tab becomes inactive.
  useEffect(() => { if (hidden && !pinned) close(); }, [hidden, pinned, close]);
  return { kind, pinned, open: setKind, close, togglePinned: () => setPinned((value) => !value) };
}
export type BrowserRecordsPanelState = ReturnType<typeof useBrowserRecordsPanel>;
