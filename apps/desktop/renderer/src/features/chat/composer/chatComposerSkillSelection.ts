import type { SlotConfigType } from '@ant-design/x/es/sender';
import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import {
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

/**
 * Ant Design X exposes insertion as a void imperative call, so verify its DOM-backed
 * value before allowing the cross-page selection request to be consumed.
 */
export function ensureChatComposerSkillSlot(
  editor: ChatComposerSkillEditor | null,
  skill: RuntimeSkillSummary,
): boolean {
  if (!editor?.getValue || !editor.insert) return false;
  const currentValue = editor.getValue();
  if (hasSelectedSkillSlot(skill.id, currentValue.slotConfig)) return true;

  const restoredSlots = restoreSerializedSkillSlot(currentValue.value, currentValue.slotConfig, skill);
  if (restoredSlots) {
    // A composer remount serializes tags into its draft. Replace that plain token
    // in place so repeated capability actions stay idempotent.
    editor.focus?.({ cursor: 'all', preventScroll: true });
    editor.insert(restoredSlots, 'cursor', undefined, true);
  } else {
    editor.focus?.({ cursor: 'start', preventScroll: true });
    editor.insert([createSelectedSkillSlot(skill), createTextSlot(' ')], 'start', undefined, true);
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
): SlotConfigType[] | null {
  if (slotConfig.some((slot) => slot.type !== 'text')) return null;
  const tokenRange = serializedSkillTokenRange(value, skillDisplayText(skill));
  if (!tokenRange) return null;
  const before = value.slice(0, tokenRange.start);
  const after = value.slice(tokenRange.end);
  return [
    ...(before ? [createTextSlot(before)] : []),
    createSelectedSkillSlot(skill),
    ...(after ? [createTextSlot(after)] : []),
  ];
}

function serializedSkillTokenRange(value: string, token: string): { start: number; end: number } | null {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = value.match(new RegExp(`(^|\\s)${escapedToken}(?=\\s|$)`, 'u'));
  if (!match || match.index === undefined) return null;
  const start = match.index + (match[1]?.length ?? 0);
  return { start, end: start + token.length };
}
