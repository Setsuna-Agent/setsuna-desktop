import type { SlotConfigType } from '@ant-design/x/es/sender';
import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import {
  createSelectedSkillReferences,
  createSelectedSkillSlot,
  createTextSlot,
  hasSelectedSkillSlot,
} from './chatComposerSlots.js';
import { skillDisplayText } from './chatCommandUtils.js';

type ChatComposerSkillEditor = {
  focus?: (options: { cursor?: 'start' | 'end' | 'all'; preventScroll?: boolean }) => void;
  getValue?: () => { value: string; slotConfig: SlotConfigType[] };
  insert?: (
    slots: SlotConfigType[],
    position?: 'start' | 'end' | 'cursor',
    replaceCharacters?: string,
    preventScroll?: boolean,
  ) => void;
};

export type ChatComposerSkillSelectionScheduler = {
  cancelFrame: (frameId: number) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
};

export type ChatComposerSkillSelectionSession = {
  serializedRange?: { start: number; end: number };
};

/**
 * Ant Design X exposes insertion as a void imperative call, so verify its DOM-backed
 * value before allowing the cross-page selection request to be consumed.
 */
export function ensureChatComposerSkillSlot(
  editor: ChatComposerSkillEditor | null,
  skill: RuntimeSkillSummary,
  session: ChatComposerSkillSelectionSession = {},
): boolean {
  if (!editor?.getValue || !editor.insert) return false;
  const currentValue = editor.getValue();
  if (hasSelectedSkillSlot(skill.id, currentValue.slotConfig)) {
    const reference = createSelectedSkillReferences(currentValue.slotConfig)
      .find((item) => item.skillId === skill.id);
    if (reference) {
      const leadingTrim = currentValue.value.length - currentValue.value.trimStart().length;
      session.serializedRange = {
        start: reference.start + leadingTrim,
        end: reference.end + leadingTrim,
      };
    }
    return true;
  }

  const restoredSlots = session.serializedRange
    ? restoreSerializedSkillSlot(currentValue.value, currentValue.slotConfig, skill, session.serializedRange)
    : null;
  if (restoredSlots) {
    // Sender can briefly serialize a tag while initializing. Only restore the exact
    // position inserted by this selection session; ordinary matching text stays text.
    editor.focus?.({ cursor: 'all', preventScroll: true });
    editor.insert(restoredSlots, 'cursor', undefined, true);
  } else {
    const token = skillDisplayText(skill);
    editor.focus?.({ cursor: 'start', preventScroll: true });
    editor.insert([createSelectedSkillSlot(skill), createTextSlot(' ')], 'start', undefined, true);
    const insertedValue = editor.getValue();
    if (
      hasSelectedSkillSlot(skill.id, insertedValue.slotConfig)
      || insertedValue.value === `${token} ${currentValue.value}`
    ) {
      session.serializedRange = { start: 0, end: token.length };
    }
  }
  return hasSelectedSkillSlot(skill.id, editor.getValue().slotConfig);
}

/**
 * Sender initializes its slot DOM in an effect. Defer insertion until that effect
 * settles, then require the tag to survive one more frame before consuming the
 * cross-page request. A transient reset is retried without duplicating the tag.
 */
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
  const session: ChatComposerSkillSelectionSession = {};

  const schedule = (callback: FrameRequestCallback) => {
    frameId = scheduler.requestFrame((time) => {
      frameId = null;
      callback(time);
    });
  };
  const attempt = () => {
    if (cancelled) return;
    attemptCount += 1;
    const inserted = ensureChatComposerSkillSlot(getEditor(), skill, session);
    if (!inserted) {
      if (attemptCount < maxAttempts) schedule(attempt);
      return;
    }
    schedule(confirm);
  };
  const confirm = () => {
    if (cancelled) return;
    const slotConfig = getEditor()?.getValue?.().slotConfig;
    if (hasSelectedSkillSlot(skill.id, slotConfig)) {
      cancelled = true;
      onConfirmed();
      return;
    }
    if (attemptCount < maxAttempts) schedule(attempt);
  };

  schedule(attempt);
  return () => {
    cancelled = true;
    if (frameId !== null) scheduler.cancelFrame(frameId);
  };
}

function restoreSerializedSkillSlot(
  value: string,
  slotConfig: SlotConfigType[],
  skill: RuntimeSkillSummary,
  range: { start: number; end: number },
): SlotConfigType[] | null {
  if (slotConfig.some((slot) => slot.type !== 'text')) return null;
  const token = skillDisplayText(skill);
  if (
    range.start < 0
    || range.end !== range.start + token.length
    || range.end > value.length
    || value.slice(range.start, range.end) !== token
  ) return null;
  const before = value.slice(0, range.start);
  const after = value.slice(range.end);
  return [
    ...(before ? [createTextSlot(before)] : []),
    createSelectedSkillSlot(skill),
    ...(after ? [createTextSlot(after)] : []),
  ];
}
