import type { SlotConfigType } from '@ant-design/x/es/sender';
import type {
  RuntimeSkillReference,
  RuntimeSkillSummary,
  WorkspaceEntrySearchItem,
} from '@setsuna-desktop/contracts';
import { WorkspaceMentionLabel } from '../mentions/WorkspaceMentionLabel.js';
import { SkillReferenceLabel } from '../skills/SkillReference.js';
import { entryLabel, skillDisplayText } from './chatCommandUtils.js';

const workspaceMentionSlotKeyPrefix = 'workspace:';
const selectedSkillSlotKeyPrefix = 'skill:';

export type WorkspaceMentionInsertion = {
  replaceCharacters?: string;
  slots: SlotConfigType[];
};

export function createTextSlot(value: string): SlotConfigType {
  return { type: 'text', value };
}

export function createSelectedSkillSlot(skill: RuntimeSkillSummary): SlotConfigType {
  const tokenText = skillDisplayText(skill);
  return {
    type: 'tag',
    key: selectedSkillSlotKey(skill.id),
    props: {
      label: <SkillReferenceLabel skill={skill} />,
      value: tokenText,
    },
    formatResult: () => tokenText,
  };
}

export function filterSelectedSkillsBySlots(
  skills: RuntimeSkillSummary[],
  slotConfig: SlotConfigType[] | undefined,
): RuntimeSkillSummary[] {
  const selectedSlotKeys = new Set(
    (slotConfig ?? [])
      .map((slot) => slot.key)
      .filter((key): key is string => (
        typeof key === 'string'
        && key.startsWith(selectedSkillSlotKeyPrefix)
      )),
  );
  const filteredSkills = skills.filter((skill) => selectedSlotKeys.has(selectedSkillSlotKey(skill.id)));
  return filteredSkills.length === skills.length ? skills : filteredSkills;
}

export function hasSelectedSkillSlot(
  skillId: string,
  slotConfig: SlotConfigType[] | undefined,
): boolean {
  const slotKey = selectedSkillSlotKey(skillId);
  return (slotConfig ?? []).some((slot) => slot.key === slotKey);
}

/** Serialize exact Skill slot offsets after the same outer whitespace trim used by sendTurn. */
export function createSelectedSkillReferences(
  slotConfig: SlotConfigType[] | undefined,
): RuntimeSkillReference[] {
  const slots = slotConfig ?? [];
  const serializedContent = slots.map(serializedSlotValue).join('');
  const leadingTrim = serializedContent.length - serializedContent.trimStart().length;
  const trimmedEnd = serializedContent.trimEnd().length;
  const references: RuntimeSkillReference[] = [];
  let offset = 0;

  for (const slot of slots) {
    const value = serializedSlotValue(slot);
    const skillId = selectedSkillIdForSlot(slot);
    const end = offset + value.length;
    if (skillId && value && offset >= leadingTrim && end <= trimmedEnd) {
      references.push({ skillId, start: offset - leadingTrim, end: end - leadingTrim });
    }
    offset = end;
  }
  return references;
}

export function createWorkspaceMentionSlots(entry: WorkspaceEntrySearchItem, leadingText = ''): SlotConfigType[] {
  return [
    ...(leadingText ? [createTextSlot(leadingText)] : []),
    createWorkspaceMentionSlot(entry),
    createTextSlot(' '),
  ];
}

export function createWorkspaceMentionInsertion(
  entry: WorkspaceEntrySearchItem,
  currentValue: string,
  currentSlots: SlotConfigType[],
): WorkspaceMentionInsertion | null {
  if (hasWorkspaceMentionSlot(currentSlots, entry)) return null;

  const trailingWhitespace = currentValue.match(/\s+$/)?.[0] ?? '';
  const contentBeforeTrailingWhitespace = trailingWhitespace
    ? currentValue.slice(0, -trailingWhitespace.length)
    : currentValue;
  return {
    replaceCharacters: trailingWhitespace || undefined,
    slots: createWorkspaceMentionSlots(entry, contentBeforeTrailingWhitespace.trim() ? ' ' : ''),
  };
}

function selectedSkillSlotKey(skillId: string): string {
  return `${selectedSkillSlotKeyPrefix}${skillId}`;
}

function selectedSkillIdForSlot(slot: SlotConfigType): string | null {
  if (
    slot.type !== 'tag'
    || typeof slot.key !== 'string'
    || !slot.key.startsWith(selectedSkillSlotKeyPrefix)
  ) return null;
  return slot.key.slice(selectedSkillSlotKeyPrefix.length).trim() || null;
}

function serializedSlotValue(slot: SlotConfigType): string {
  if (slot.type === 'text') return slot.value ?? '';
  if (
    slot.type === 'tag'
    && slot.props
    && 'value' in slot.props
    && typeof slot.props.value === 'string'
  ) return slot.props.value;
  return '';
}

function createWorkspaceMentionSlot(entry: WorkspaceEntrySearchItem): SlotConfigType {
  const resultText = `@${entryLabel(entry)}`;
  return {
    type: 'tag',
    key: `${workspaceMentionSlotKeyPrefix}${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    props: {
      label: (
        <WorkspaceMentionLabel
          name={entry.name}
          path={entry.path}
          serializedText={resultText}
          type={entry.kind}
        />
      ),
      value: resultText,
    },
    formatResult: () => resultText,
  };
}

function hasWorkspaceMentionSlot(slots: SlotConfigType[], entry: WorkspaceEntrySearchItem): boolean {
  const resultText = `@${entryLabel(entry)}`;
  return slots.some((slot) => (
    slot.type === 'tag'
    && slot.key.startsWith(workspaceMentionSlotKeyPrefix)
    && slot.props?.value === resultText
  ));
}
