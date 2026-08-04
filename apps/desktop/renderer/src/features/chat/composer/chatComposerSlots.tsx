import type { SlotConfigType } from '@ant-design/x/es/sender';
import type {
  RuntimeSkillSummary,
  WorkspaceEntrySearchItem,
} from '@setsuna-desktop/contracts';
import { Boxes } from 'lucide-react';
import { WorkspaceMentionLabel } from '../mentions/WorkspaceMentionLabel.js';
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
      label: (
        <span className="chat-skill-slot" title={skill.description || skill.id}>
          <Boxes size={13} />
          <span className="chat-skill-slot__name">{tokenText}</span>
        </span>
      ),
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
