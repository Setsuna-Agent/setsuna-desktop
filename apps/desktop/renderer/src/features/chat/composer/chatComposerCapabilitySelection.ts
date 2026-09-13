import type { ComposerSlot } from './editor/types.js';
import type { RuntimePluginSummary, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import {
  createSelectedSkillSlot,
  createSelectedPluginSlot,
  createTextSlot,
  getChatComposerSlotReference,
} from './chatComposerSlots.js';

type ChatComposerCapabilityEditor = {
  focus?: (options: { cursor?: 'start' | 'end' | 'all'; preventScroll?: boolean }) => void;
  getValue?: () => { value: string; slotConfig: ComposerSlot[] };
  insert?: (
    slots: ComposerSlot[],
    position?: 'start' | 'end' | 'cursor',
    replaceCharacters?: string,
    preventScroll?: boolean,
  ) => void;
};

export type ChatComposerCapabilitySelection =
  | { kind: 'skill'; value: RuntimeSkillSummary }
  | { kind: 'plugin'; value: RuntimePluginSummary };

export type ChatComposerCapabilitySelectionScheduler = {
  cancelFrame: (frameId: number) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
};

/** Consume a cross-page request only after its tag is present in the editor. */
export function ensureChatComposerCapabilitySlot(
  editor: ChatComposerCapabilityEditor | null,
  selection: ChatComposerCapabilitySelection,
): boolean {
  if (!editor?.getValue || !editor.insert) return false;
  const getValue = editor.getValue;
  const hasSelection = () => getValue().slotConfig.some((slot) => {
    const reference = getChatComposerSlotReference(slot);
    if (reference?.type === 'skill' && selection.kind === 'skill') return reference.skillId === selection.value.id;
    if (reference?.type === 'plugin' && selection.kind === 'plugin') return reference.pluginId === selection.value.id;
    return false;
  });
  if (hasSelection()) return true;
  editor.focus?.({ cursor: 'start', preventScroll: true });
  const slot = selection.kind === 'skill' ? createSelectedSkillSlot(selection.value) : createSelectedPluginSlot(selection.value);
  editor.insert([slot, createTextSlot(' ')], 'start', undefined, true);
  return hasSelection();
}

/** A requested composer may still be mounting; retry readiness and cancel on navigation. */
export function startChatComposerCapabilitySelection({
  getEditor,
  maxAttempts = 8,
  onConfirmed,
  scheduler,
  selection,
}: {
  getEditor: () => ChatComposerCapabilityEditor | null;
  maxAttempts?: number;
  onConfirmed: () => void;
  scheduler: ChatComposerCapabilitySelectionScheduler;
  selection: ChatComposerCapabilitySelection;
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
    const inserted = ensureChatComposerCapabilitySlot(getEditor(), selection);
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
