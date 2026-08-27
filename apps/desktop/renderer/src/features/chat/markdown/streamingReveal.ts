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

export type StreamingRevealTimeline = {
  nextStartAt: number;
  startedAtByKey: Map<string, number>;
};

export type StreamingRevealUnit = {
  start: number;
  text: string;
};

export const streamingRevealDurationMs = 280;
export const streamingRevealUnitStaggerMs = 14;
export const maximumStreamingRevealRanges = 20;

const streamingWordSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'word' })
  : null;

export function initialStreamingRevealState(content: string): StreamingRevealState {
  return { content, nextKey: 0, ranges: [] };
}

export function initialStreamingRevealTimeline(): StreamingRevealTimeline {
  return { nextStartAt: 0, startedAtByKey: new Map() };
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

  // The smoother emits at most a few chunks during one reveal duration. Older
  // ranges are already visually settled and should not keep producing spans.
  return {
    content,
    nextKey,
    ranges: ranges.slice(-maximumStreamingRevealRanges),
  };
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
  scheduledStartAt = now,
): StreamingRevealAnimation {
  const startedAt = startedAtByKey.get(key);
  if (startedAt === undefined) {
    startedAtByKey.set(key, scheduledStartAt);
    return {
      active: scheduledStartAt + streamingRevealDurationMs > now,
      delayMs: scheduledStartAt - now,
    };
  }

  const elapsed = now - startedAt;
  return {
    active: elapsed < streamingRevealDurationMs,
    delayMs: -Math.min(elapsed, streamingRevealDurationMs),
  };
}

/** Schedules visual units on one persistent timeline, independent of transport chunks. */
export function resolveStreamingRevealTimelineAnimation(
  timeline: StreamingRevealTimeline,
  key: string,
  now: number,
): StreamingRevealAnimation {
  const existingStart = timeline.startedAtByKey.get(key);
  if (existingStart !== undefined) {
    return resolveStreamingRevealAnimation(timeline.startedAtByKey, key, now);
  }
  const scheduledStart = Math.max(now, timeline.nextStartAt);
  timeline.nextStartAt = scheduledStart + streamingRevealUnitStaggerMs;
  return resolveStreamingRevealAnimation(
    timeline.startedAtByKey,
    key,
    now,
    scheduledStart,
  );
}

/**
 * Mirrors FlowToken's word separation while using Intl segmentation so CJK text
 * flows as short language-aware words instead of one sentence-sized chunk.
 */
export function splitStreamingRevealUnits(value: string): StreamingRevealUnit[] {
  if (!value) return [];
  if (!streamingWordSegmenter) {
    return Array.from(value).map((text, index) => ({ start: index, text }));
  }

  const units: StreamingRevealUnit[] = [];
  let leading = '';
  for (const part of streamingWordSegmenter.segment(value)) {
    if (!part.isWordLike) {
      const previous = units.at(-1);
      if (previous) previous.text += part.segment;
      else leading += part.segment;
      continue;
    }
    units.push({
      start: part.index - leading.length,
      text: `${leading}${part.segment}`,
    });
    leading = '';
  }
  if (leading) units.push({ start: 0, text: leading });
  return units;
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
