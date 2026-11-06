import { useCallback, useLayoutEffect, useRef } from 'react';

const owners = new Map<symbol, { ranges: Range[]; active: Range[] }>();

/** CSS highlights are document-wide; closing one panel must not clear another's search. */
export function useContentFindHighlights() {
  const owner = useRef(Symbol());
  const publish = useCallback((ranges: Range[], active: Range[]) => {
    owners.set(owner.current, { ranges, active });
    syncHighlights();
  }, []);
  useLayoutEffect(() => {
    const key = owner.current;
    return () => {
      owners.delete(key);
      syncHighlights();
    };
  }, []);
  return publish;
}

function syncHighlights() {
  if (!owners.size) {
    CSS.highlights.delete('content-find-match');
    CSS.highlights.delete('content-find-active');
    return;
  }
  const matches = new Highlight();
  const active = new Highlight();
  active.priority = 1;
  for (const value of owners.values()) {
    for (const range of value.ranges) matches.add(range);
    for (const range of value.active) active.add(range);
  }
  CSS.highlights.set('content-find-match', matches);
  CSS.highlights.set('content-find-active', active);
}
