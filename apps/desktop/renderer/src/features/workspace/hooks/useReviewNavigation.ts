import type {
  FileDiff,
  PostRenderPhase,
  SelectionSide,
  Virtualizer,
} from '@pierre/diffs';
import { useVirtualizer } from '@pierre/diffs/react';
import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefCallback,
} from 'react';
import type { DesktopReviewFocusRequest } from '../model.js';
import { normalizeReviewFocusPath } from '../review-paths.js';
import type { ReviewFindingAnnotationAnchor, ReviewFindingTarget } from '../review-findings.js';

const REVIEW_NAVIGATION_TOLERANCE_PX = 2;
const REVIEW_NAVIGATION_STABLE_FRAMES = 4;
const REVIEW_NAVIGATION_TIMEOUT_MS = 5_000;
const REVIEW_NAVIGATION_SETTLE_WINDOW_MS = 1_500;

type ReviewNavigationAlignment = 'center' | 'start';
type ReviewDiffLinePosition = { top: number; height: number };
type ReviewDiffNavigationTarget = {
  element: HTMLElement;
  getLinePosition: (
    lineNumber: number,
    side?: SelectionSide,
  ) => ReviewDiffLinePosition | undefined;
};
type ReviewNavigationSession = {
  deadline: number;
  key: string;
  settledUntil: number | null;
  stableFrames: number;
};
type ReviewNavigationState = {
  anchor: ReviewFindingAnnotationAnchor | null;
  fileKey: string | null;
  finalKey: string | null;
  findingKey: string | null;
  requestKey: string | null;
};

export type ReviewDiffNavigationRegistration = (
  node: HTMLElement,
  instance: FileDiff<ReactNode>,
  phase: PostRenderPhase,
) => void;

export function reviewFileNavigationTargetKey(path: string): string {
  return `file:${normalizeReviewFocusPath(path) ?? path.trim()}`;
}

export function reviewFindingNavigationTargetKey(
  target: Pick<ReviewFindingTarget, 'key'>,
): string {
  return `finding:${target.key}`;
}

/**
 * Coordinates navigation for the whole review virtualizer. Pierre exposes an
 * exact virtual line position before that line is rendered, while a React
 * annotation only receives layout after its Shadow DOM slot is mounted. The
 * controller therefore first brings the line into the render window, then
 * aligns the real card after it has measurable layout.
 */
export function useReviewNavigation({
  findingTarget,
  focusRequest,
}: {
  findingTarget: ReviewFindingTarget | null;
  focusRequest?: DesktopReviewFocusRequest | null;
}) {
  const virtualizer = useVirtualizer();
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const diffTargetsRef = useRef(new Map<string, ReviewDiffNavigationTarget>());
  const elementCallbacksRef = useRef(new Map<string, RefCallback<HTMLElement>>());
  const diffCallbacksRef = useRef(
    new Map<string, ReviewDiffNavigationRegistration>(),
  );
  const observerRef = useRef<ResizeObserver | null>(null);
  const frameRef = useRef<number | null>(null);
  const sessionRef = useRef<ReviewNavigationSession | null>(null);
  const stateRef = useRef<ReviewNavigationState>({
    anchor: null,
    fileKey: null,
    finalKey: null,
    findingKey: null,
    requestKey: null,
  });
  const advanceNavigationRef = useRef<() => void>(() => undefined);

  const scheduleAlignment = useCallback(() => {
    if (frameRef.current !== null || sessionRef.current === null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      advanceNavigationRef.current();
    });
  }, []);

  const getTargetRef = useCallback((key: string): RefCallback<HTMLElement> => {
    const existing = elementCallbacksRef.current.get(key);
    if (existing) return existing;
    const callback: RefCallback<HTMLElement> = (element) => {
      const previous = elementsRef.current.get(key);
      if (previous === element) return;
      if (previous) observerRef.current?.unobserve(previous);
      if (element) {
        elementsRef.current.set(key, element);
        observerRef.current?.observe(element);
      } else {
        elementsRef.current.delete(key);
      }
      scheduleAlignment();
    };
    elementCallbacksRef.current.set(key, callback);
    return callback;
  }, [scheduleAlignment]);

  const getDiffTargetRegistration = useCallback((
    key: string,
  ): ReviewDiffNavigationRegistration => {
    const existing = diffCallbacksRef.current.get(key);
    if (existing) return existing;
    const callback: ReviewDiffNavigationRegistration = (
      element,
      instance,
      phase,
    ) => {
      const previous = diffTargetsRef.current.get(key);
      if (phase === 'unmount') {
        if (previous?.element === element) {
          observerRef.current?.unobserve(element);
          diffTargetsRef.current.delete(key);
        }
        scheduleAlignment();
        return;
      }
      if (!isReviewDiffNavigationInstance(instance)) return;
      if (previous?.element !== element) {
        if (previous) observerRef.current?.unobserve(previous.element);
        observerRef.current?.observe(element);
      }
      diffTargetsRef.current.set(key, {
        element,
        getLinePosition: (lineNumber, side) => (
          instance.getLinePosition(lineNumber, side)
        ),
      });
      scheduleAlignment();
    };
    diffCallbacksRef.current.set(key, callback);
    return callback;
  }, [scheduleAlignment]);

  const findingKey = findingTarget
    ? reviewFindingNavigationTargetKey(findingTarget)
    : null;
  const fileKey = findingTarget?.file
    ? reviewFileNavigationTargetKey(findingTarget.file.path)
    : focusRequest?.path
      ? reviewFileNavigationTargetKey(focusRequest.path)
      : null;
  const finalKey = findingKey ?? fileKey;
  const anchor = findingTarget?.anchor ?? null;
  const requestKey = focusRequest && finalKey
    ? JSON.stringify([
        focusRequest.version,
        finalKey,
        fileKey,
        anchor?.lineNumber ?? null,
        anchor?.side ?? null,
      ])
    : null;
  stateRef.current = {
    anchor,
    fileKey,
    finalKey,
    findingKey,
    requestKey,
  };

  advanceNavigationRef.current = () => {
    const session = sessionRef.current;
    const state = stateRef.current;
    if (!session || session.key !== state.requestKey || !state.finalKey) return;
    const now = Date.now();
    if (
      now > session.deadline
      || (session.settledUntil !== null && now > session.settledUntil)
    ) {
      sessionRef.current = null;
      return;
    }

    const finalElement = elementsRef.current.get(state.finalKey) ?? null;
    if (finalElement && reviewNavigationTargetHasLayout(finalElement)) {
      const aligned = alignReviewNavigationTarget(
        virtualizer,
        finalElement,
        state.findingKey ? 'center' : 'start',
      );
      if (!aligned) {
        session.stableFrames = 0;
        session.settledUntil = null;
        scheduleAlignment();
        return;
      }
      session.stableFrames += 1;
      if (session.stableFrames < REVIEW_NAVIGATION_STABLE_FRAMES) {
        scheduleAlignment();
        return;
      }
      // Keep the session briefly available for Pierre's delayed height
      // reconciliation. ResizeObserver may resume it, but ordinary user scroll
      // does not, so navigation never fights subsequent manual scrolling.
      session.settledUntil ??= now + REVIEW_NAVIGATION_SETTLE_WINDOW_MS;
      return;
    }

    session.stableFrames = 0;
    session.settledUntil = null;
    const diffTarget = state.fileKey
      ? diffTargetsRef.current.get(state.fileKey) ?? null
      : null;
    const linePosition = state.anchor && diffTarget
      ? diffTarget.getLinePosition(
          state.anchor.lineNumber,
          state.anchor.side,
        )
      : undefined;
    if (diffTarget && linePosition) {
      alignReviewNavigationLine(virtualizer, diffTarget.element, linePosition);
      scheduleAlignment();
      return;
    }

    // A collapsed file has no FileDiff instance yet. Bring its card into view;
    // ReviewFileCard expands it for this request and registration resumes the
    // exact line phase above.
    const fileElement = state.fileKey
      ? elementsRef.current.get(state.fileKey) ?? null
      : null;
    if (fileElement && reviewNavigationTargetHasLayout(fileElement)) {
      alignReviewNavigationTarget(virtualizer, fileElement, 'start');
    }
    scheduleAlignment();
  };

  useEffect(() => {
    if (!requestKey) {
      sessionRef.current = null;
      return undefined;
    }
    sessionRef.current = {
      deadline: Date.now() + REVIEW_NAVIGATION_TIMEOUT_MS,
      key: requestKey,
      settledUntil: null,
      stableFrames: 0,
    };
    scheduleAlignment();
    return () => {
      if (sessionRef.current?.key === requestKey) {
        sessionRef.current = null;
      }
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [requestKey, scheduleAlignment]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(scheduleAlignment);
    observerRef.current = observer;
    const root = virtualizer?.getRoot();
    if (root instanceof HTMLElement) observer.observe(root);
    const content = root instanceof Document
      ? root.documentElement
      : root?.firstElementChild;
    if (content instanceof HTMLElement) observer.observe(content);
    for (const element of elementsRef.current.values()) observer.observe(element);
    for (const target of diffTargetsRef.current.values()) {
      observer.observe(target.element);
    }
    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
    };
  }, [scheduleAlignment, virtualizer]);

  useEffect(() => () => {
    sessionRef.current = null;
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  return { getDiffTargetRegistration, getTargetRef };
}

function isReviewDiffNavigationInstance(
  instance: FileDiff<ReactNode>,
): instance is FileDiff<ReactNode> & {
  getLinePosition: (
    lineNumber: number,
    side?: SelectionSide,
  ) => ReviewDiffLinePosition | undefined;
} {
  return 'getLinePosition' in instance
    && typeof instance.getLinePosition === 'function';
}

function reviewNavigationTargetHasLayout(target: HTMLElement): boolean {
  return target.isConnected && target.getBoundingClientRect().height > 0;
}

function alignReviewNavigationTarget(
  virtualizer: Virtualizer | undefined,
  target: HTMLElement,
  alignment: ReviewNavigationAlignment,
): boolean {
  const targetRect = target.getBoundingClientRect();
  if (!target.isConnected || targetRect.height <= 0) return false;
  if (!virtualizer?.getRoot()) {
    target.scrollIntoView({
      block: alignment,
      inline: 'nearest',
      behavior: 'auto',
    });
    return true;
  }
  return alignReviewNavigationOffset(
    virtualizer,
    virtualizer.getOffsetInScrollContainer(target),
    targetRect.height,
    alignment,
  );
}

function alignReviewNavigationLine(
  virtualizer: Virtualizer | undefined,
  diffElement: HTMLElement,
  linePosition: ReviewDiffLinePosition,
): boolean {
  if (!virtualizer?.getRoot() || !diffElement.isConnected) return false;
  return alignReviewNavigationOffset(
    virtualizer,
    virtualizer.getOffsetInScrollContainer(diffElement) + linePosition.top,
    linePosition.height,
    'center',
  );
}

function alignReviewNavigationOffset(
  virtualizer: Virtualizer,
  targetOffset: number,
  targetHeight: number,
  alignment: ReviewNavigationAlignment,
): boolean {
  const root = virtualizer.getRoot();
  if (!root) return false;
  virtualizer.markDOMDirty();
  const rootRect = root instanceof Document
    ? { height: window.innerHeight }
    : root.getBoundingClientRect();
  const viewportHeight = root instanceof Document
    ? window.innerHeight
    : root.clientHeight || rootRect.height;
  if (viewportHeight <= 0) return false;

  const alignmentOffset = alignment === 'center'
    ? Math.max(0, (viewportHeight - targetHeight) / 2)
    : 0;
  const scrollHeight = root instanceof Document
    ? root.documentElement.scrollHeight
    : root.scrollHeight;
  const requestedScrollTop = Math.max(
    0,
    Math.min(
      targetOffset - alignmentOffset,
      Math.max(0, scrollHeight - viewportHeight),
    ),
  );
  const currentScrollTop = virtualizer.getScrollTop();
  if (
    Math.abs(currentScrollTop - requestedScrollTop)
      <= REVIEW_NAVIGATION_TOLERANCE_PX
  ) return true;

  virtualizer.scrollTo({ top: requestedScrollTop, behavior: 'auto' });
  return false;
}
