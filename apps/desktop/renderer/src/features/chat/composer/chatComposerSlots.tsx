import type { ComposerSlot } from './editor/types.js';
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

export type ChatComposerSlotReference =
  | { type: 'skill'; skillId: string }
  | { type: 'workspace'; entry: WorkspaceEntrySearchItem };

export type ChatComposerReferenceSlot = Extract<ComposerSlot, { type: 'tag' }> & {
  composerReference: ChatComposerSlotReference;
};

export type WorkspaceMentionInsertion = {
  replaceCharacters?: string;
  slots: ComposerSlot[];
};

export function createTextSlot(value: string): ComposerSlot {
  return { type: 'text', value };
}

export function createSelectedSkillSlot(skill: RuntimeSkillSummary): ChatComposerReferenceSlot {
  const tokenText = skillDisplayText(skill);
  return {
    type: 'tag',
    key: createReferenceSlotKey(selectedSkillSlotKeyPrefix),
    composerReference: { type: 'skill', skillId: skill.id },
    props: {
      label: <SkillReferenceLabel skill={skill} />,
      value: tokenText,
    },
  };
}

export function filterSelectedSkillsBySlots(
  skills: RuntimeSkillSummary[],
  slotConfig: ComposerSlot[] | undefined,
): RuntimeSkillSummary[] {
  const selectedSkillIds = new Set(
    (slotConfig ?? [])
      .map(selectedSkillIdForSlot)
      .filter((skillId): skillId is string => Boolean(skillId)),
  );
  const filteredSkills = skills.filter((skill) => selectedSkillIds.has(skill.id));
  return filteredSkills.length === skills.length ? skills : filteredSkills;
}

export function hasSelectedSkillSlot(
  skillId: string,
  slotConfig: ComposerSlot[] | undefined,
): boolean {
  return (slotConfig ?? []).some((slot) => selectedSkillIdForSlot(slot) === skillId);
}

/** Serialize exact Skill slot offsets after the same outer whitespace trim used by sendTurn. */
export function createSelectedSkillReferences(
  slotConfig: ComposerSlot[] | undefined,
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

export function createWorkspaceMentionSlots(entry: WorkspaceEntrySearchItem, leadingText = ''): ComposerSlot[] {
  return [
    ...(leadingText ? [createTextSlot(leadingText)] : []),
    createWorkspaceMentionReferenceSlot(entry),
    createTextSlot(' '),
  ];
}

export function createWorkspaceMentionReferenceSlot(
  entry: WorkspaceEntrySearchItem,
): ChatComposerReferenceSlot {
  const resultText = `@${entryLabel(entry)}`;
  return {
    type: 'tag',
    key: createReferenceSlotKey(workspaceMentionSlotKeyPrefix),
    composerReference: { type: 'workspace', entry },
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
  };
}

export function getChatComposerSlotReference(
  slot: ComposerSlot,
): ChatComposerSlotReference | null {
  return (slot as Partial<ChatComposerReferenceSlot>).composerReference ?? null;
}

export function createWorkspaceMentionInsertion(
  entry: WorkspaceEntrySearchItem,
  currentValue: string,
  currentSlots: ComposerSlot[],
): WorkspaceMentionInsertion | null {
  if (hasWorkspaceMentionSlot(currentSlots, entry)) return null;

  const needsLeadingSpace = Boolean(currentValue) && !/\s$/u.test(currentValue);
  return {
    // ChatPromptInput cannot reliably replace a trailing text node after multiple imperative
    // insertions. Preserve existing whitespace and only add a separator when needed.
    slots: createWorkspaceMentionSlots(entry, needsLeadingSpace ? ' ' : ''),
  };
}

function selectedSkillIdForSlot(slot: ComposerSlot): string | null {
  const reference = getChatComposerSlotReference(slot);
  return reference?.type === 'skill' ? reference.skillId : null;
}

function createReferenceSlotKey(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function serializedSlotValue(slot: ComposerSlot): string {
  if (slot.type === 'text') return slot.value ?? '';
  if (
    slot.type === 'tag'
    && slot.props
    && 'value' in slot.props
    && typeof slot.props.value === 'string'
  ) return slot.props.value;
  return '';
}

function hasWorkspaceMentionSlot(slots: ComposerSlot[], entry: WorkspaceEntrySearchItem): boolean {
  const resultText = `@${entryLabel(entry)}`;
  return slots.some((slot) => (
    slot.type === 'tag'
    && slot.key.startsWith(workspaceMentionSlotKeyPrefix)
    && slot.props?.value === resultText
  ));
}
