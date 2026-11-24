import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { DesignScene } from '../design-layout.js';

const revealOptions = { block: 'nearest', inline: 'nearest', container: 'nearest' } as const;

export function useDesignLayerTree({ documentId, scene, selectedIds, visible, reordering }: Readonly<{
  documentId: string;
  scene: DesignScene;
  selectedIds: readonly string[];
  visible: boolean;
  reordering: boolean;
}>) {
  // The old preference recorded exceptions to an expanded default.
  const key = `setsuna.design.expanded-layers:${documentId}`;
  const [expandedLayerIds, setExpandedLayerIds] = useState<ReadonlySet<string>>(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null');
      const ids: unknown[] = Array.isArray(saved) ? saved : [];
      return new Set(ids.filter((id): id is string => typeof id === 'string'));
    } catch { return new Set<string>(); }
  });
  const previous = useRef(expandedLayerIds);
  useLayoutEffect(() => {
    if (previous.current === expandedLayerIds) return;
    previous.current = expandedLayerIds;
    // Save each committed change before the editor can unmount on navigation.
    try {
      if (expandedLayerIds.size) window.localStorage.setItem(key, JSON.stringify([...expandedLayerIds]));
      else window.localStorage.removeItem(key);
    } catch { /* Keep the in-session preference when storage is unavailable. */ }
  }, [expandedLayerIds, key]);

  const expandLayers = useCallback((ids: readonly string[]) => {
    setExpandedLayerIds((current) => {
      if (ids.every((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  function toggleLayer(id: string) {
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const revealId = visible ? selectedIds.at(-1) : undefined;
  const revealRow = useRef<HTMLButtonElement>(null);
  const revealed = useRef<readonly string[]>();

  function collapseAllLayers() {
    // Keep the current selection without reopening its ancestors.
    revealed.current = selectedIds;
    setExpandedLayerIds(new Set());
  }

  useLayoutEffect(() => {
    if (revealId === undefined) {
      revealed.current = undefined;
      return;
    }
    if (reordering || revealed.current === selectedIds) return;
    if (revealRow.current) {
      revealRow.current.scrollIntoView(revealOptions);
      revealed.current = selectedIds;
      return;
    }
    // Commit expanded ancestors first so the target row exists before scrolling.
    const parents: string[] = [];
    for (let parent = scene[revealId]?.parentId; parent; parent = scene[parent]?.parentId) {
      if (!expandedLayerIds.has(parent)) parents.push(parent);
    }
    if (parents.length) expandLayers(parents);
  }, [expandLayers, expandedLayerIds, reordering, revealId, scene, selectedIds]);

  return { expandedLayerIds, expandLayers, toggleLayer, collapseAllLayers, revealId, revealRow };
}
