import type { FileDiff, FileDiffMetadata, PostRenderPhase } from '@pierre/diffs';
import { useVirtualizer } from '@pierre/diffs/react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useContentFindSource } from '../find/contentFindSources.js';
import { codeDiffFindLines, createCodeFindSource } from './codeFindSource.js';

export function useDiffFind(diff: FileDiffMetadata) {
  const virtualizer = useVirtualizer();
  const instanceRef = useRef<FileDiff<ReactNode> | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const onPostRender = useCallback((node: HTMLElement, instance: FileDiff<ReactNode>, phase: PostRenderPhase) => {
    if (phase === 'unmount') return;
    instanceRef.current = instance;
    setElement((current) => current === node ? current : node);
  }, []);
  const source = useMemo(() => element ? createCodeFindSource(element, () => codeDiffFindLines(diff), (position) => {
    const instance = instanceRef.current;
    const root = virtualizer?.getRoot();
    if (!instance || !virtualizer || !root || !('getLinePosition' in instance) || typeof instance.getLinePosition !== 'function') return;
    const line = instance.getLinePosition(position.line, position.side) as { top: number; height: number } | undefined;
    if (!line) return;
    const height = root instanceof Document ? window.innerHeight : root.clientHeight;
    virtualizer.scrollTo({
      top: Math.max(0, virtualizer.getOffsetInScrollContainer(element) + line.top - (height - line.height) / 2),
      behavior: 'auto',
    });
  }) : null, [diff, element, virtualizer]);
  useContentFindSource(source);
  return onPostRender;
}
