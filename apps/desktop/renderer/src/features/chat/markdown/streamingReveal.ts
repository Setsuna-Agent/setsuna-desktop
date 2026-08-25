export type StreamingRevealRange = {
  end: number;
  key: number;
  start: number;
};

export type StreamingRevealState = {
  content: string;
  nextKey: number;
  ranges: StreamingRevealRange[];
};

export type StreamingRevealAnimation = {
  active: boolean;
  delayMs: number;
};

export const streamingRevealDurationMs = 280;

export function initialStreamingRevealState(content: string): StreamingRevealState {
  return { content, nextKey: 0, ranges: [] };
}

/**
 * Retains completed reveal ranges while the mutable Markdown tail grows. This lets
 * each chunk finish its own transition instead of being replaced by the next delta.
 */
export function reconcileStreamingRevealState(
  previous: StreamingRevealState,
  content: string,
  mutable: boolean,
): StreamingRevealState {
  if (!mutable) return initialStreamingRevealState(content);
  if (content === previous.content) return previous;

  const stablePrefixLength = commonPrefixLength(previous.content, content);
  const ranges = previous.ranges.flatMap((range) => {
    if (range.start >= stablePrefixLength) return [];
    const end = Math.min(range.end, stablePrefixLength);
    return end > range.start ? [{ ...range, end }] : [];
  });
  let nextKey = previous.nextKey;
  if (stablePrefixLength < content.length) {
    ranges.push({
      end: content.length,
      key: nextKey,
      start: stablePrefixLength,
    });
    nextKey += 1;
  }

  return { content, nextKey, ranges };
}

/**
 * Preserves an entering chunk's timeline across ReactMarkdown reparses. Reusing
 * the original start time prevents an already visible phrase from replaying its
 * blur/offset transition when the mutable Markdown tail changes shape.
 */
export function resolveStreamingRevealAnimation(
  startedAtByKey: Map<string, number>,
  key: string,
  now: number,
): StreamingRevealAnimation {
  const startedAt = startedAtByKey.get(key);
  if (startedAt === undefined) {
    startedAtByKey.set(key, now);
    return { active: true, delayMs: 0 };
  }

  const elapsed = Math.max(0, now - startedAt);
  return {
    active: elapsed < streamingRevealDurationMs,
    delayMs: -Math.min(elapsed, streamingRevealDurationMs),
  };
}

function commonPrefixLength(previousContent: string, content: string): number {
  const maximumLength = Math.min(previousContent.length, content.length);
  let offset = 0;
  while (offset < maximumLength && previousContent[offset] === content[offset]) {
    offset += 1;
  }
  // Keep a reveal boundary outside a UTF-16 surrogate pair.
  if (offset > 0 && offset < content.length) {
    const previousCodeUnit = content.charCodeAt(offset - 1);
    const nextCodeUnit = content.charCodeAt(offset);
    if (
      previousCodeUnit >= 0xD800
      && previousCodeUnit <= 0xDBFF
      && nextCodeUnit >= 0xDC00
      && nextCodeUnit <= 0xDFFF
    ) {
      return offset - 1;
    }
  }
  return offset;
}
