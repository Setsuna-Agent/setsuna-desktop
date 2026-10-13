import { animate, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { SPRING_LAYOUT } from '../motion.js';

type Position = { left: number; top: number };
const animations = new WeakMap<HTMLElement, AnimationPlaybackControls>();

function translation(element: HTMLElement): Position {
  const [left, top] = getComputedStyle(element).getPropertyValue('translate').split(' ');
  return { left: Number.parseFloat(left) || 0, top: Number.parseFloat(top) || 0 };
}

/** Hit testing uses the destination layout, not a neighbour's intermediate spring position. */
export function reorderItemRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect();
  const offset = translation(element);
  const scale = element.offsetWidth ? rect.width / element.offsetWidth : 1;
  return new DOMRect(rect.left - offset.left * scale, rect.top - offset.top * scale, rect.width, rect.height);
}

function positions(root: HTMLElement | null) {
  return new Map(Array.from(root?.querySelectorAll<HTMLElement>('[data-reorder-id]') ?? [])
    .map((element) => [element, { left: element.offsetLeft, top: element.offsetTop }] as const));
}

function animatePositions(before: Map<HTMLElement, Position>, after: Map<HTMLElement, Position>, reduce: boolean) {
  for (const [element, target] of after) {
    const origin = before.get(element);
    if (!origin || (origin.left === target.left && origin.top === target.top)) continue;
    const offset = translation(element);
    animations.get(element)?.stop();
    // Keep layout movement separate from a tab's existing entrance/exit transform animation.
    animations.set(element, animate(element, {
      translate: [`${origin.left - target.left + offset.left}px ${origin.top - target.top + offset.top}px`, '0px 0px'],
    }, reduce ? { duration: 0 } : SPRING_LAYOUT));
  }
}

/** The same beUI layout spring for existing pointer-driven tabs, without replacing their drag protocol. */
export function useReorderLayout(root: RefObject<HTMLElement | null>, orderKey: string, active: boolean) {
  const reduce = useReducedMotion() ?? false;
  const previous = useRef(new Map<HTMLElement, Position>());
  useLayoutEffect(() => {
    if (!active) { previous.current.clear(); return; }
    const next = positions(root.current);
    animatePositions(previous.current, next, reduce);
    previous.current = next;
  }, [root, orderKey, active, reduce]);
  useLayoutEffect(() => {
    const container = root.current;
    return () => {
      for (const element of positions(container).keys()) animations.get(element)?.stop();
    };
  }, [root]);
}

/** Cross-slot placeholders are inserted imperatively; animate their neighbours with the same spring. */
export function animateReorderLayout(root: HTMLElement, change: () => void) {
  const before = positions(root);
  change();
  animatePositions(before, positions(root), root.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false);
}
