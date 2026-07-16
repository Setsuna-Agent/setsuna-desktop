import type { SlotConfigType } from '@ant-design/x/es/sender';
import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { entryLabel } from './chatCommandUtils.js';

const workspaceMentionSlotKeyPrefix = 'workspace:';

export type WorkspaceMentionInsertion = {
  replaceCharacters?: string;
  slots: SlotConfigType[];
};

export function createTextSlot(value: string): SlotConfigType {
  return { type: 'text', value };
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
    slots: createWorkspaceMentionSlots(entry, contentBeforeTrailingWhitespace.trim() ? '\n' : ''),
  };
}

function createWorkspaceMentionSlot(entry: WorkspaceEntrySearchItem): SlotConfigType {
  const displayText = `@${entryDisplayName(entry)}`;
  const resultText = `@${entryLabel(entry)}`;
  return {
    type: 'tag',
    key: `${workspaceMentionSlotKeyPrefix}${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    props: {
      label: (
        <span className="chat-workspace-mention-slot" title={entry.path}>
          {displayText}
        </span>
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

function entryDisplayName(entry: WorkspaceEntrySearchItem): string {
  const fallback = entry.path.split('/').filter(Boolean).pop() || entry.path;
  const name = (entry.name || fallback).trim() || fallback;
  return entry.kind === 'directory' ? `${name.replace(/\/$/, '')}/` : name;
}
