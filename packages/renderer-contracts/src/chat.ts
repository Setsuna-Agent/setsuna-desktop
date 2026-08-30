import type { RuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  defineChainRendererSlot,
  defineListRendererSlot,
  defineSingleRendererSlot,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  RendererTranslate,
  RendererUiRegistrar,
} from '@setsuna-desktop/feature-core/renderer';
import type { Disposer } from '@setsuna-desktop/feature-core/scope';
import type { ComponentType } from 'react';
import type { ReactNode } from 'react';

export type ChatSurfaceSlotProps = Readonly<{
  /** Distinguishes the primary conversation from side/subagent surfaces. */
  surfaceInstanceId: string;
  renderDefault(): ReactNode;
}>;

export const chatConversationSlot = defineSingleRendererSlot<ChatSurfaceSlotProps>({
  id: 'renderer.chat.conversation',
  scope: 'thread',
  userConfigurable: true,
});

export const chatComposerSlot = defineSingleRendererSlot<ChatSurfaceSlotProps>({
  id: 'renderer.chat.composer',
  scope: 'thread',
  userConfigurable: true,
});

export const chatDetailsSlot = defineSingleRendererSlot<ChatSurfaceSlotProps>({
  id: 'renderer.chat.details',
  scope: 'thread',
  userConfigurable: true,
});

export type ChatComposerActiveTurn = Readonly<{
  startedAt?: string;
  taskKind?: string;
}>;

export type ChatComposerStatusSlotProps = Readonly<{
  activeTurn?: ChatComposerActiveTurn;
  threadId: string;
  translate: RendererTranslate;
}>;

export const chatComposerStatusSlot = defineListRendererSlot<ChatComposerStatusSlotProps>({
  id: 'renderer.chat.composer.status',
  scope: 'thread',
  userConfigurable: true,
});

export type ChatToolResultViewProps<TPayload> = Readonly<{
  payload: TPayload;
  threadId: string | null;
  translate: RendererTranslate;
}>;

export type ChatToolResultRegistration<TPayload> = Readonly<{
  id: string;
  resultKind: `${string}.${string}`;
  major: number;
  payload: RuntimeCodec<TPayload>;
  sourceToolNames?: readonly string[];
  legacy?: Readonly<{
    matches(value: unknown): boolean;
    payload: RuntimeCodec<TPayload>;
  }>;
  identity?: (payload: TPayload) => string | null;
  presentation?: 'details' | 'replace';
  placement?: 'inline' | 'assistant-tail';
  workHistoryPresentation?: 'persistent';
  render: ComponentType<ChatToolResultViewProps<TPayload>>;
}>;

export type ErasedChatToolResultRegistration = Readonly<{
  id: string;
  resultKind: `${string}.${string}`;
  major: number;
  payload: RuntimeCodec<unknown>;
  sourceToolNames?: readonly string[];
  legacy?: Readonly<{
    matches(value: unknown): boolean;
    payload: RuntimeCodec<unknown>;
  }>;
  identity?: (payload: unknown) => string | null;
  presentation?: 'details' | 'replace';
  placement?: 'inline' | 'assistant-tail';
  workHistoryPresentation?: 'persistent';
  render: ComponentType<ChatToolResultViewProps<unknown>>;
}>;

export type ChatToolResultResolverInput = Readonly<{
  toolName?: string;
  value: unknown;
}>;

export type ResolvedChatToolResult = Readonly<{
  contribution: ErasedChatToolResultRegistration;
  featureId: string;
  payload: unknown;
}>;

export const chatToolResultResolverSlot = defineChainRendererSlot<
  ChatToolResultResolverInput,
  ResolvedChatToolResult | null
>({
  id: 'renderer.chat.tool-result.resolve',
  scope: 'thread',
});

export function registerChatToolResult<TPayload>(
  ui: RendererUiRegistrar,
  contribution: ChatToolResultRegistration<TPayload>,
): Disposer {
  validateToolResultContribution(contribution);
  const erased = eraseToolResultContribution(contribution);
  const featureId = ui.owner.featureId ?? ui.owner.pluginId;
  return ui.chain(chatToolResultResolverSlot, {
    id: `tool-result.${contribution.resultKind}.v${contribution.major}`,
    select: ({ toolName, value }) => {
      const envelope = toolResultEnvelope(value);
      if (envelope) {
        if (
          envelope.resultKind !== erased.resultKind
          || envelope.resultMajor !== erased.major
          || !matchesToolResultSource(erased, toolName)
        ) return null;
        try {
          return resolvedToolResult(featureId, erased, erased.payload.parse(envelope.payload));
        } catch {
          console.warn(`[feature-tool-result] Invalid payload for ${erased.resultKind}@${erased.major}.`);
          return null;
        }
      }
      if (!matchesToolResultSource(erased, toolName)) return null;
      const legacy = erased.legacy;
      if (!legacy || !legacy.matches(value)) return null;
      try {
        return resolvedToolResult(featureId, erased, legacy.payload.parse(value));
      } catch {
        console.warn(`[feature-tool-result] Invalid legacy payload for ${erased.id}.`);
        return null;
      }
    },
  });
}

function validateToolResultContribution<TPayload>(
  contribution: ChatToolResultRegistration<TPayload>,
): void {
  const identityPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
  if (!identityPattern.test(contribution.id) || !identityPattern.test(contribution.resultKind)) {
    throw new Error('Tool result contribution identifiers must be stable dotted identifiers.');
  }
  if (!Number.isSafeInteger(contribution.major) || contribution.major < 1) {
    throw new Error('Tool result contribution major must be a positive integer.');
  }
  if (contribution.sourceToolNames && (
    contribution.sourceToolNames.length === 0
    || contribution.sourceToolNames.some((name) => typeof name !== 'string' || !name.trim())
  )) {
    throw new Error('Tool result source tool names must be non-empty strings.');
  }
}

function eraseToolResultContribution<TPayload>(
  contribution: ChatToolResultRegistration<TPayload>,
): ErasedChatToolResultRegistration {
  const { identity, legacy, sourceToolNames, ...base } = contribution;
  return Object.freeze({
    ...base,
    ...(sourceToolNames ? { sourceToolNames: Object.freeze([...sourceToolNames]) } : {}),
    payload: Object.freeze({ parse: (value: unknown) => contribution.payload.parse(value) as unknown }),
    ...(identity ? { identity: (payload: unknown) => identity(payload as TPayload) } : {}),
    ...(legacy ? {
      legacy: Object.freeze({
        matches: legacy.matches,
        payload: Object.freeze({ parse: (value: unknown) => legacy.payload.parse(value) as unknown }),
      }),
    } : {}),
    render: contribution.render as ComponentType<ChatToolResultViewProps<unknown>>,
  });
}

function matchesToolResultSource(
  contribution: ErasedChatToolResultRegistration,
  toolName: string | undefined,
): boolean {
  return !contribution.sourceToolNames
    || Boolean(toolName && contribution.sourceToolNames.includes(toolName));
}

function resolvedToolResult(
  featureId: string,
  contribution: ErasedChatToolResultRegistration,
  payload: unknown,
): ResolvedChatToolResult {
  return Object.freeze({ contribution, featureId, payload });
}

function toolResultEnvelope(value: unknown): Readonly<{
  resultKind: `${string}.${string}`;
  resultMajor: number;
  payload: unknown;
}> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.resultKind !== 'string'
    || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u.test(record.resultKind)
    || !Number.isSafeInteger(record.resultMajor)
    || (record.resultMajor as number) < 1
    || !('payload' in record)
  ) return null;
  return {
    resultKind: record.resultKind as `${string}.${string}`,
    resultMajor: record.resultMajor as number,
    payload: record.payload,
  };
}
