import { useEffect, useRef, useState } from 'react';

const streamCadenceMs = 40;
const streamBoundaryCadenceMs = 28;
const streamMaximumHoldMs = 96;
const streamMinimumChunkCharacters = 4;

/**
 * Keeps transport-sized deltas out of the Markdown renderer. Providers may emit one
 * character at a time; the UI instead reveals short, readable chunks at a steady pace.
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
  const characters = Array.from(pendingContent);
  if (characters.length === 0) return 0;

  const targetLength = streamingChunkTarget(characters.length);
  if (characters.length <= targetLength) return pendingContent.length;

  const earliestBoundary = Math.max(1, Math.floor(targetLength * 0.6));
  const latestBoundary = Math.min(characters.length, targetLength + 6);
  for (let index = latestBoundary - 1; index >= earliestBoundary - 1; index -= 1) {
    if (isNaturalStreamingBoundary(characters[index] ?? '')) {
      return characters.slice(0, index + 1).join('').length;
    }
  }

  // Array.from keeps surrogate pairs intact; converting the selected characters
  // back to a string gives us the correct UTF-16 offset for String.slice.
  return characters.slice(0, targetLength).join('').length;
}

function streamingChunkTarget(pendingLength: number): number {
  if (pendingLength > 240) return 48;
  if (pendingLength > 120) return 32;
  if (pendingLength > 48) return 20;
  return 10;
}

function hasNaturalStreamingBoundary(content: string): boolean {
  return Array.from(content).some(isNaturalStreamingBoundary);
}

function isNaturalStreamingBoundary(character: string): boolean {
  return /[\s,，、。！？!?；;：:）)\]}]/u.test(character);
}
