import type { SlotConfigType } from '@ant-design/x/es/sender';
import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import {
  createSelectedSkillSlot,
  createTextSlot,
  createWorkspaceMentionReferenceSlot,
  getChatComposerSlotReference,
  type ChatComposerSlotReference,
} from './chatComposerSlots.js';

export const CHAT_COMPOSER_CLIPBOARD_TYPE = 'application/x-setsuna-chat-composer+json';

type ChatComposerClipboardPart =
  | { type: 'text'; value: string }
  | ChatComposerSlotReference;

type ChatComposerClipboardPayload = {
  version: 1;
  parts: ChatComposerClipboardPart[];
};

export type ChatComposerClipboardSelection = {
  payload: string;
  plainText: string;
  range: Range;
};

export type ChatComposerClipboardPastePlan = {
  selectedSkills: RuntimeSkillSummary[];
  slots: SlotConfigType[];
};

export function createChatComposerClipboardSelection(
  editor: HTMLDivElement,
  slotConfig: SlotConfigType[],
  selection: Selection | null = window.getSelection(),
): ChatComposerClipboardSelection | null {
  const range = selectedRangeWithin(editor, selection);
  if (!range) return null;

  const slotsByKey = keyedSlots(slotConfig);
  const normalizedRange = normalizeReferenceBoundaries(range, editor, slotsByKey);
  const parts = serializeSelectedParts(normalizedRange, slotsByKey);
  if (!parts.some((part) => part.type !== 'text')) return null;

  return {
    payload: JSON.stringify({ version: 1, parts } satisfies ChatComposerClipboardPayload),
    plainText: cleanClipboardText(normalizedRange.toString()),
    range: normalizedRange,
  };
}

export function createChatComposerClipboardPastePlan(
  serializedPayload: string,
  skills: RuntimeSkillSummary[],
): ChatComposerClipboardPastePlan | null {
  const payload = parseClipboardPayload(serializedPayload);
  if (!payload) return null;

  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const selectedSkills: RuntimeSkillSummary[] = [];
  const selectedSkillIds = new Set<string>();
  const slots: SlotConfigType[] = [];

  for (const part of payload.parts) {
    if (part.type === 'text') {
      appendTextSlot(slots, part.value);
      continue;
    }
    if (part.type === 'workspace') {
      slots.push(createWorkspaceMentionReferenceSlot(part.entry));
      continue;
    }

    const skill = skillsById.get(part.skillId);
    if (!skill?.enabled) return null;
    slots.push(createSelectedSkillSlot(skill));
    if (!selectedSkillIds.has(skill.id)) {
      selectedSkillIds.add(skill.id);
      selectedSkills.push(skill);
    }
  }

  return slots.length ? { selectedSkills, slots } : null;
}

export function setNormalizedChatComposerSelection(
  editor: HTMLDivElement,
  slotConfig: SlotConfigType[],
  selection: Selection | null = window.getSelection(),
): void {
  const range = selectedRangeWithin(editor, selection);
  if (!range || !selection) return;
  const normalizedRange = normalizeReferenceBoundaries(range, editor, keyedSlots(slotConfig));
  selection.removeAllRanges();
  selection.addRange(normalizedRange);
}

export function deleteChatComposerClipboardSelection(
  editor: HTMLDivElement,
  clipboardSelection: ChatComposerClipboardSelection,
  selection: Selection | null = window.getSelection(),
): void {
  const range = clipboardSelection.range;
  range.deleteContents();
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  editor.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'deleteByCut',
  }));
}

function selectedRangeWithin(editor: HTMLDivElement, selection: Selection | null): Range | null {
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (
    range.collapsed
    || !containsNode(editor, range.startContainer)
    || !containsNode(editor, range.endContainer)
  ) return null;
  return range.cloneRange();
}

function containsNode(editor: HTMLDivElement, node: Node): boolean {
  return node === editor || editor.contains(node);
}

function keyedSlots(slotConfig: SlotConfigType[]): Map<string, SlotConfigType> {
  const slots = new Map<string, SlotConfigType>();
  for (const slot of slotConfig) {
    if (slot.key) slots.set(slot.key, slot);
  }
  return slots;
}

function normalizeReferenceBoundaries(
  sourceRange: Range,
  editor: HTMLDivElement,
  slotsByKey: Map<string, SlotConfigType>,
): Range {
  const range = sourceRange.cloneRange();
  const startSlot = referenceSlotContaining(range.startContainer, editor, slotsByKey);
  const endSlot = referenceSlotContaining(range.endContainer, editor, slotsByKey);
  if (startSlot) range.setStartBefore(startSlot);
  if (endSlot) range.setEndAfter(endSlot);
  return range;
}

function referenceSlotContaining(
  node: Node,
  editor: HTMLDivElement,
  slotsByKey: Map<string, SlotConfigType>,
): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  const slotElement = element?.closest<HTMLElement>('[data-slot-key]') ?? null;
  if (!slotElement || slotElement.parentElement !== editor) return null;
  const slot = slotsByKey.get(slotElement.dataset.slotKey ?? '');
  return slot && getChatComposerSlotReference(slot) ? slotElement : null;
}

function serializeSelectedParts(
  range: Range,
  slotsByKey: Map<string, SlotConfigType>,
): ChatComposerClipboardPart[] {
  const parts: ChatComposerClipboardPart[] = [];
  const fragment = range.cloneContents();

  for (const node of fragment.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      appendTextPart(parts, node.textContent ?? '');
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;

    const slot = slotsByKey.get(node.dataset.slotKey ?? '');
    const reference = slot ? getChatComposerSlotReference(slot) : null;
    if (reference) {
      parts.push(reference);
    } else {
      appendTextPart(parts, node.textContent ?? '');
    }
  }

  return parts;
}

function appendTextPart(parts: ChatComposerClipboardPart[], value: string): void {
  const cleanedValue = cleanClipboardText(value);
  if (!cleanedValue) return;
  const previous = parts.at(-1);
  if (previous?.type === 'text') {
    previous.value += cleanedValue;
  } else {
    parts.push({ type: 'text', value: cleanedValue });
  }
}

function appendTextSlot(slots: SlotConfigType[], value: string): void {
  if (!value) return;
  const previous = slots.at(-1);
  if (previous?.type === 'text') {
    previous.value = `${previous.value ?? ''}${value}`;
  } else {
    slots.push(createTextSlot(value));
  }
}

function cleanClipboardText(value: string): string {
  return value.replace(/\u200B/g, '').replace(/\u00A0/g, ' ');
}

function parseClipboardPayload(serializedPayload: string): ChatComposerClipboardPayload | null {
  try {
    const payload: unknown = JSON.parse(serializedPayload);
    if (!isRecord(payload) || payload.version !== 1 || !Array.isArray(payload.parts)) return null;
    if (!payload.parts.every(isClipboardPart)) return null;
    return payload as ChatComposerClipboardPayload;
  } catch {
    return null;
  }
}

function isClipboardPart(value: unknown): value is ChatComposerClipboardPart {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'text') return typeof value.value === 'string';
  if (value.type === 'skill') return typeof value.skillId === 'string' && Boolean(value.skillId);
  if (value.type !== 'workspace' || !isRecord(value.entry)) return false;
  return (value.entry.kind === 'file' || value.entry.kind === 'directory')
    && typeof value.entry.name === 'string'
    && typeof value.entry.path === 'string'
    && typeof value.entry.parent === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
