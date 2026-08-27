import { useEffect, useRef, useState } from 'react';
import { splitStreamingRevealUnits } from './streamingReveal.js';

const streamCadenceMs = 48;
const streamBoundaryCadenceMs = 44;
const streamMaximumHoldMs = 96;
const streamMinimumChunkCharacters = 4;
const streamMaximumRevealUnits = 3;

/**
 * Keeps transport-sized deltas out of the Markdown renderer. Providers may emit one
 * character at a time or a large burst; the UI releases at most a few visual words per
 * commit so the compositor animation can always progress in source order.
 */
export function useSmoothedStreamingContent(content: string, streaming: boolean): string {
  const [visibleContent, setVisibleContent] = useState(content);
  const pendingSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!streaming) {
      pendingSinceRef.current = null;
      setVisibleContent((current) => (current === content ? current : content));
      return undefined;
    }

    if (!content.startsWith(visibleContent)) {
      pendingSinceRef.current = null;
      setVisibleContent(content);
      return undefined;
    }

    const pendingContent = content.slice(visibleContent.length);
    if (!pendingContent) {
      pendingSinceRef.current = null;
      return undefined;
    }

    const now = Date.now();
    pendingSinceRef.current ??= now;
    const remainingHold = Math.max(
      0,
      streamMaximumHoldMs - (now - pendingSinceRef.current),
    );
    const hasBoundary = hasNaturalStreamingBoundary(pendingContent);
    const awaitingReadableChunk = Array.from(pendingContent).length < streamMinimumChunkCharacters
      && !hasBoundary;
    const cadence = hasBoundary
      ? streamBoundaryCadenceMs
      : streamCadenceMs;
    // The maximum hold is an absolute deadline, so a busy stream cannot keep
    // restarting the cadence timer and starve the visible update.
    const delay = awaitingReadableChunk ? remainingHold : Math.min(cadence, remainingHold);

    const timer = setTimeout(() => {
      setVisibleContent((current) => {
        if (!content.startsWith(current)) return content;
        const latestPending = content.slice(current.length);
        if (!latestPending) return current;
        const chunkLength = nextStreamingChunkLength(latestPending);
        pendingSinceRef.current = Date.now();
        return current + latestPending.slice(0, chunkLength);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [content, streaming, visibleContent]);

  // Completion and non-append rewrites must never wait for the smoothing timer.
  if (!streaming || !content.startsWith(visibleContent)) return content;
  return visibleContent;
}

export function nextStreamingChunkLength(pendingContent: string): number {
  if (!pendingContent) return 0;
  const units = splitStreamingRevealUnits(pendingContent);
  const nextUnit = units[streamMaximumRevealUnits];
  return nextUnit?.start && nextUnit.start > 0
    ? nextUnit.start
    : pendingContent.length;
}

function hasNaturalStreamingBoundary(content: string): boolean {
  return Array.from(content).some(isNaturalStreamingBoundary);
}

function isNaturalStreamingBoundary(character: string): boolean {
  return /[\s,，、。！？!?；;：:）)\]}]/u.test(character);
}
