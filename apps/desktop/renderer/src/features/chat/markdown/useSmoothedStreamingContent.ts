import { useEffect, useRef, useState } from 'react';

// Match beUI's continuous text cadence, accelerating when transport bursts build up.
const streamCharactersPerSecond = 110;
const streamCatchUpWindowMs = 500;
const streamSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

type StreamState = {
  target: string;
  visible: string;
  frame: number | null;
};

/** One frame loop consumes the latest text without restarting for each network delta. */
export function useSmoothedStreamingContent(content: string, streaming: boolean): string {
  const [visibleContent, setVisibleContent] = useState(content);
  const stateRef = useRef<StreamState>({ target: content, visible: content, frame: null });

  useEffect(() => {
    const state = stateRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    state.target = content;

    if (!streaming || reducedMotion.matches || !content.startsWith(state.visible)) {
      cancelStreamFrame(state);
      state.visible = content;
      setVisibleContent(content);
      return;
    }
    if (state.frame !== null || state.visible === content) return;

    let previousTime = performance.now();
    let characterBudget = 0;
    const advance = (now: number) => {
      state.frame = null;
      if (reducedMotion.matches) {
        state.visible = state.target;
        setVisibleContent(state.visible);
        return;
      }

      const pendingLength = state.target.length - state.visible.length;
      const speed = Math.max(streamCharactersPerSecond, pendingLength * 1000 / streamCatchUpWindowMs);
      characterBudget += Math.max(0, now - previousTime) * speed / 1000;
      previousTime = now;
      const count = Math.floor(characterBudget);
      if (count > 0) {
        const offset = nextVisibleOffset(state.target, state.visible.length, count);
        characterBudget -= count;
        state.visible = state.target.slice(0, offset);
        setVisibleContent(state.visible);
      }
      if (state.visible.length < state.target.length) {
        state.frame = window.requestAnimationFrame(advance);
      }
    };
    state.frame = window.requestAnimationFrame(advance);
  }, [content, streaming]);

  useEffect(() => {
    const state = stateRef.current;
    return () => cancelStreamFrame(state);
  }, []);

  // History, completion and corrections use the exact source immediately.
  if (!streaming || !content.startsWith(visibleContent)) return content;
  return visibleContent;
}

function cancelStreamFrame(state: StreamState): void {
  if (state.frame !== null) window.cancelAnimationFrame(state.frame);
  state.frame = null;
}

function nextVisibleOffset(content: string, offset: number, count: number): number {
  // Grapheme boundaries preserve emoji sequences and combining marks as well as CJK.
  for (const part of streamSegmenter.segment(content.slice(offset))) {
    if (count <= 0) break;
    offset += part.segment.length;
    count -= 1;
  }
  return offset;
}
