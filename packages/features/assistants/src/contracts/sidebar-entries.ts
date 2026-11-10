import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { identity, record, text } from './codec.js';

export const ASSISTANT_SIDEBAR_TITLE_LIMIT = 120;
export type AssistantSidebarTarget = { assistantId: string; kind: 'task' | 'reminder'; entryId: string };
export type AssistantSidebarPatch = { title?: string; pinned?: boolean };

export const assistantSidebarTargetCodec = defineRuntimeCodec<AssistantSidebarTarget>((value) => {
  const input = record(value);
  if (input.kind !== 'task' && input.kind !== 'reminder') throw new Error('Invalid sidebar entry kind.');
  return { assistantId: identity(input.assistantId), kind: input.kind, entryId: identity(input.entryId) };
});

export const assistantSidebarUpdateCodec = defineRuntimeCodec<AssistantSidebarTarget & AssistantSidebarPatch>((value) => {
  const input = record(value);
  const target = assistantSidebarTargetCodec.parse(input);
  if (input.title === undefined && input.pinned === undefined) throw new Error('No sidebar entry change supplied.');
  if (input.pinned !== undefined && typeof input.pinned !== 'boolean') throw new Error('Invalid pin state.');
  return { ...target,
    ...(input.title === undefined ? {} : { title: text(input.title, 'title', ASSISTANT_SIDEBAR_TITLE_LIMIT) }),
    ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
  };
});
