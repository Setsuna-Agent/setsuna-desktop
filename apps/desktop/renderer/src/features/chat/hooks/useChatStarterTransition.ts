import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { pageScaleInverse } from '../../../shared/lib/zoomedPortalPosition.js';

export const CHAT_STARTER_SETTLE_DURATION_MS = 360;

type StarterTransition = {
  composerHeight: number;
  offsetY: number;
  phase: 'settling' | 'settled';
  starterKey: string;
};

export function useChatStarterTransition({
  conversationRef,
  sourceVisible,
  starterKey,
}: {
  conversationRef: RefObject<HTMLDivElement | null>;
  sourceVisible: boolean;
  starterKey: string;
}) {
  const [transition, setTransition] = useState<StarterTransition | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current === null) return;
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    clearSettleTimer();
    setTransition(null);
  }, [clearSettleTimer]);

  const begin = useCallback(() => {
    if (!sourceVisible || transition) return false;
    const conversation = conversationRef.current;
    const composer = conversation?.querySelector<HTMLElement>('[data-chat-starter-composer-motion]');
    if (!conversation || !composer) return false;

    const conversationRect = conversation.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const bottomInset = cssPixelValue(
      window.getComputedStyle(conversation).getPropertyValue('--chat-composer-bottom-inset'),
      16,
    );
    const scaleInverse = pageScaleInverse();
    const offsetY = chatStarterSettleOffset({
      bottomInset,
      composerBottom: composerRect.bottom,
      conversationBottom: conversationRect.bottom,
      scaleInverse,
    });

    setTransition({
      // 发送后多行草稿会立即清空；锁住外壳高度才能让底边始终落在同一位置。
      composerHeight: composerRect.height * scaleInverse,
      offsetY,
      phase: 'settling',
      starterKey,
    });
    clearSettleTimer();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      setTransition((current) => current
        ? { ...current, phase: 'settled' }
        : current);
    }, reducedMotion ? 0 : CHAT_STARTER_SETTLE_DURATION_MS);
    return true;
  }, [clearSettleTimer, conversationRef, sourceVisible, starterKey, transition]);

  useEffect(() => {
    if (transition?.phase !== 'settled' || sourceVisible) return;
    setTransition(null);
  }, [sourceVisible, transition?.phase]);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  return {
    begin,
    cancel,
    composerHeight: transition?.composerHeight ?? 0,
    offsetY: transition?.offsetY ?? 0,
    phase: transition?.phase ?? null,
    starterKey: transition?.starterKey ?? starterKey,
    visible: sourceVisible || transition !== null,
  };
}

export function chatStarterSettleOffset({
  bottomInset,
  composerBottom,
  conversationBottom,
  scaleInverse,
}: {
  bottomInset: number;
  composerBottom: number;
  conversationBottom: number;
  scaleInverse: number;
}): number {
  const safeScaleInverse = Number.isFinite(scaleInverse) && scaleInverse > 0 ? scaleInverse : 1;
  return Math.max(0, (conversationBottom - composerBottom) * safeScaleInverse - bottomInset);
}

function cssPixelValue(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
