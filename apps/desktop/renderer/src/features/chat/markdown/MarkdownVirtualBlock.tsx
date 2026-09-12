import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { pageScaleInverse } from '../../../shared/lib/zoomedPortalPosition.js';
import { MarkdownContentBlock } from './MarkdownContentBlock.js';
import { useMarkdownViewport } from './MarkdownViewportProvider.js';

const markdownVirtualizationBlockThreshold = 24;
const markdownVirtualizationCharacterThreshold = 16_000;
const estimatedMarkdownLineWidth = 88;
const measuredHeightEpsilon = 0.1;

type MarkdownVirtualBlockProps = {
  content: string;
  forceRender: boolean;
  mutable: boolean;
  virtualized: boolean;
};

export const MarkdownVirtualBlock = memo(function MarkdownVirtualBlock({
  content,
  forceRender,
  mutable,
  virtualized,
}: MarkdownVirtualBlockProps) {
  const viewport = useMarkdownViewport();
  const blockRef = useRef<HTMLDivElement | null>(null);
  const estimatedHeight = useMemo(() => estimateMarkdownBlockHeight(content), [content]);
  const canVirtualize = virtualized
    && Boolean(viewport?.supported);
  const [intersectsViewport, setIntersectsViewport] = useState(false);
  const [placeholderHeight, setPlaceholderHeight] = useState(estimatedHeight);
  const shouldRender = !canVirtualize || forceRender || intersectsViewport;

  useEffect(() => {
    if (!canVirtualize) return undefined;

    const block = blockRef.current;
    if (!block || !viewport) return undefined;
    return viewport.observe(block, setIntersectsViewport) ?? undefined;
  }, [canVirtualize, viewport]);

  useEffect(() => {
    // Non-virtualized blocks never need a placeholder height. Avoid attaching one
    // ResizeObserver per Markdown block in ordinary conversations.
    if (!canVirtualize || !shouldRender) return undefined;
    const block = blockRef.current;
    if (!block) return undefined;

    const measure = () => {
      const nextHeight = measureMarkdownBlockHeight(block);
      if (nextHeight > 0) {
        setPlaceholderHeight((current) => (
          Math.abs(current - nextHeight) > measuredHeightEpsilon ? nextHeight : current
        ));
      }
    };
    measure();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(block);
    return () => observer.disconnect();
  }, [canVirtualize, content, shouldRender]);

  const className = [
    'chat-markdown__block',
    mutable ? 'is-mutable' : '',
    canVirtualize && !shouldRender ? 'is-virtual-placeholder' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      data-markdown-block={mutable ? 'mutable' : 'stable'}
      data-markdown-virtual={canVirtualize ? (shouldRender ? 'rendered' : 'placeholder') : undefined}
      ref={blockRef}
      style={shouldRender ? undefined : { height: placeholderHeight }}
    >
      {shouldRender ? (
        <MarkdownContentBlock content={content} />
      ) : null}
    </div>
  );
});

export function shouldVirtualizeMarkdownBlocks(blocks: Array<{ content: string }>): boolean {
  if (blocks.length >= markdownVirtualizationBlockThreshold) return true;
  let characterCount = 0;
  for (const block of blocks) {
    characterCount += block.content.length;
    if (characterCount >= markdownVirtualizationCharacterThreshold) return true;
  }
  return false;
}

export function estimateMarkdownBlockHeight(content: string): number {
  const lines = content.split('\n');
  const firstLine = lines[0]?.trimStart() ?? '';
  if (/^(```|~~~)/.test(firstLine)) {
    return Math.max(64, (Math.max(1, lines.length - 2) * 21) + 58);
  }
  if (lines.length >= 2 && /^\s*\|/.test(firstLine)) {
    return Math.max(44, lines.length * 34);
  }

  const visualLineCount = lines.reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.length / estimatedMarkdownLineWidth)),
    0,
  );
  const headingOffset = /^#{1,6}\s/.test(firstLine) ? 18 : 0;
  return Math.max(30, (visualLineCount * 24) + headingOffset + 8);
}

export function normalizeMarkdownBlockHeight({
  rectHeight,
  scaleInverse = 1,
}: {
  rectHeight: number;
  scaleInverse?: number;
}): number {
  const safeScaleInverse = Number.isFinite(scaleInverse) && scaleInverse > 0 ? scaleInverse : 1;
  return rectHeight * safeScaleInverse;
}

function measureMarkdownBlockHeight(block: HTMLDivElement): number {
  // flow-root contains child margins, so the border box is the entire block's
  // footprint. Adding margins again would change scroll height on every swap.
  // Keep fractional CSS pixels when converting the zoomed DOMRect to a placeholder.
  return normalizeMarkdownBlockHeight({
    rectHeight: block.getBoundingClientRect().height,
    scaleInverse: pageScaleInverse(),
  });
}
