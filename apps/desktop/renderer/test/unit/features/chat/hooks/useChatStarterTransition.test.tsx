// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_STARTER_SETTLE_DURATION_MS,
  chatStarterSettleOffset,
  useChatStarterTransition,
} from '../../../../../src/features/chat/hooks/useChatStarterTransition.js';

afterEach(() => {
  document.documentElement.style.removeProperty('--app-page-scale-inverse');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useChatStarterTransition', () => {
  it('keeps the starter mounted until its composer reaches the bottom slot', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    document.documentElement.style.setProperty('--app-page-scale-inverse', '1');

    const conversation = document.createElement('div');
    const composer = document.createElement('div');
    composer.dataset.chatStarterComposerMotion = '';
    conversation.style.setProperty('--chat-composer-bottom-inset', '16px');
    conversation.append(composer);
    conversation.getBoundingClientRect = () => rect({ bottom: 900, height: 900 });
    composer.getBoundingClientRect = () => rect({ bottom: 500, height: 104 });
    const conversationRef = { current: conversation } as RefObject<HTMLDivElement>;

    const view = renderHook(
      ({ sourceVisible }) => useChatStarterTransition({
        conversationRef,
        sourceVisible,
        starterKey: 'starter',
      }),
      { initialProps: { sourceVisible: true } },
    );

    act(() => {
      expect(view.result.current.begin()).toBe(true);
    });
    expect(view.result.current.phase).toBe('settling');
    expect(view.result.current.composerHeight).toBe(104);
    expect(view.result.current.offsetY).toBe(384);

    view.rerender({ sourceVisible: false });
    expect(view.result.current.visible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(CHAT_STARTER_SETTLE_DURATION_MS);
    });
    expect(view.result.current.visible).toBe(false);
  });
});

describe('chatStarterSettleOffset', () => {
  it('converts viewport distance into the scaled CSS coordinate space', () => {
    expect(chatStarterSettleOffset({
      bottomInset: 16,
      composerBottom: 500,
      conversationBottom: 900,
      scaleInverse: 1.25,
    })).toBe(484);
  });
});

function rect({ bottom, height }: { bottom: number; height: number }): DOMRect {
  return {
    bottom,
    height,
    left: 0,
    right: 0,
    top: bottom - height,
    width: 0,
    x: 0,
    y: bottom - height,
    toJSON: () => ({}),
  };
}
