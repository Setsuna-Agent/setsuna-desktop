import type { ComposerSlot } from './editor/types.js';
import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import {
  createSelectedSkillSlot,
  createTextSlot,
  hasSelectedSkillSlot,
} from './chatComposerSlots.js';

type ChatComposerSkillEditor = {
  focus?: (options: { cursor?: 'start' | 'end' | 'all'; preventScroll?: boolean }) => void;
  getValue?: () => { value: string; slotConfig: ComposerSlot[] };
  insert?: (
    slots: ComposerSlot[],
    position?: 'start' | 'end' | 'cursor',
    replaceCharacters?: string,
    preventScroll?: boolean,
  ) => void;
};

export type ChatComposerSkillSelectionScheduler = {
  cancelFrame: (frameId: number) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
};

/** Consume a cross-page Skill request only after its tag is present in the editor. */
export function ensureChatComposerSkillSlot(
  editor: ChatComposerSkillEditor | null,
  skill: RuntimeSkillSummary,
): boolean {
  if (!editor?.getValue || !editor.insert) return false;
  if (hasSelectedSkillSlot(skill.id, editor.getValue().slotConfig)) return true;
  editor.focus?.({ cursor: 'start', preventScroll: true });
  editor.insert([createSelectedSkillSlot(skill), createTextSlot(' ')], 'start', undefined, true);
  return hasSelectedSkillSlot(skill.id, editor.getValue().slotConfig);
}

/** A requested composer may still be mounting; retry readiness and cancel on navigation. */
export function startChatComposerSkillSelection({
  getEditor,
  maxAttempts = 8,
  onConfirmed,
  scheduler,
  skill,
}: {
  getEditor: () => ChatComposerSkillEditor | null;
  maxAttempts?: number;
  onConfirmed: () => void;
  scheduler: ChatComposerSkillSelectionScheduler;
  skill: RuntimeSkillSummary;
}): () => void {
  let attemptCount = 0;
  let cancelled = false;
  let frameId: number | null = null;

  const schedule = (callback: FrameRequestCallback) => {
    frameId = scheduler.requestFrame((time) => {
      frameId = null;
      callback(time);
    });
  };
  const attempt = () => {
    if (cancelled) return;
    attemptCount += 1;
    const inserted = ensureChatComposerSkillSlot(getEditor(), skill);
    if (!inserted) {
      if (attemptCount < maxAttempts) schedule(attempt);
      return;
    }
    cancelled = true;
    onConfirmed();
  };

  schedule(attempt);
  return () => {
    cancelled = true;
    if (frameId !== null) scheduler.cancelFrame(frameId);
  };
}
