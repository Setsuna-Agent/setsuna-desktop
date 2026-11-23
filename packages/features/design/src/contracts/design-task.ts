import type { ChatDesignTools } from './chat-design.js';
import type { DesignCommandKey } from './design-command-key.js';
import type { RuntimeEditorSelection, RuntimeMessage, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type { DesignConversationOwner, DesignConversation } from './design-conversations.js';
import { parseDesignEdit, type DesignEdit } from './document.js';
import { readDesignDocument, type DesignDocumentRef } from './operations.js';

export const maxDesignTaskEdits = 20_000;
export const designLayoutChecks = ['outOfBounds', 'textOverflow', 'lowContrast', 'occludedText', 'possibleOverlap', 'fillInHug'] as const;
export const designToolNames = ['design_inspect', 'design_edit', 'design_preview', 'design_resources', 'design_export', 'design_prototype', 'design_view', 'design_asset', 'design_document'] as const;
export type DesignToolName = typeof designToolNames[number];
export const designActions = ['update', 'bindTokens', 'insert', 'layout', 'removeLayout', 'align', 'group', 'frame', 'ungroup', 'duplicate',
  'delete', 'paste', 'replace', 'front', 'back', 'component', 'detach', 'mask', 'removeMask', 'union', 'subtract', 'variant', 'override', 'createVariant', 'insertInstance', 'insertSvg', 'freehand', 'convertScript', 'reparent', 'reorder',
  'setStyle', 'setVariableCollection', 'moveVariable', 'linkLibrary', 'unlinkLibrary'] as const;

export type DesignTaskStart = { sessionId: string; canvasRequestId?: string; clientId?: string; ref: DesignDocumentRef; documentId: string; selection: string[]; threadId: string };
export type DesignAgent = Readonly<{ threadId: string; turnId: string; name: string; colorIndex: number }>;
export type DesignTaskResult = { content: string; image?: string; failed?: boolean; plan?: { revision: string; edits: DesignEdit[] } };
export type DesignTaskStep = { kind: 'tool'; id: string; agent?: DesignAgent; name: DesignToolName; args: Record<string, unknown>; networkAccess?: boolean; selection?: string[] }
  | { kind: 'applied'; id: string; revision: string; agent?: DesignAgent }
  | { kind: 'agentDone'; id: string; agent: DesignAgent }
  | { kind: 'ready'; id: string }
  | { kind: 'done' };
export type DesignTaskReply = { sessionId: string; id: string; result: DesignTaskResult };
export type DesignInputBinding = { sessionId: string; clientId: string; selection: string[] };
export type DesignToolPolicy = { networkAccess: boolean; inputClientId?: string };
export type DesignTaskClient = {
  watchCommand(input: DesignCommandKey, signal: AbortSignal): Promise<null>;
  bindInput(input: DesignInputBinding, signal: AbortSignal): Promise<null>;
  start(input: DesignTaskStart, signal: AbortSignal): Promise<DesignTaskStep>;
  reply(input: DesignTaskReply, signal: AbortSignal): Promise<DesignTaskStep>;
  stop(sessionId: string): Promise<null>;
};

export function designTaskRecord(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Expected design task arguments.');
  return value as Record<string, unknown>;
}

/** An explicit root destination applies to this edit; it does not clear the task's selection scope. */
export function requestedDesignRootEdit(args: Record<string, unknown>): 'insert' | 'reparent' | undefined {
  if (args.action === 'insert' && Array.isArray(args.ids) && args.ids.length === 0) return 'insert';
  if (args.action === 'reparent' && designTaskRecord(args.fields ?? {}).parentId === null) return 'reparent';
}

function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid design task text.');
  return value;
}
function token(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid design task identifier.');
  return value;
}
function readAgent(input: unknown): DesignAgent {
  const { threadId, turnId, name, colorIndex } = designTaskRecord(input);
  if (typeof colorIndex !== 'number' || !Number.isSafeInteger(colorIndex) || colorIndex < 0) throw new Error('Invalid design agent color.');
  return { threadId: string(threadId, 256), turnId: string(turnId, 256), name: string(name, 256), colorIndex };
}
const step = defineRuntimeCodec<DesignTaskStep>((input) => {
  const value = designTaskRecord(input);
  if (value.kind === 'done') return { kind: 'done' };
  if (value.kind === 'agentDone') return { kind: 'agentDone', id: token(value.id), agent: readAgent(value.agent) };
  const identity = value.agent === undefined ? {} : { agent: readAgent(value.agent) };
  if (value.kind === 'applied') return { kind: 'applied', ...identity, id: token(value.id), revision: string(value.revision, 256) };
  if (value.kind === 'ready') return { kind: 'ready', id: token(value.id) };
  const name = designToolNames.find((item) => item === value.name);
  if (value.kind !== 'tool' || !name) throw new Error('Unknown design tool.');
  return { kind: 'tool', ...identity, id: token(value.id), name, args: designTaskRecord(value.args), networkAccess: value.networkAccess === true,
    selection: value.selection === undefined ? undefined : readDesignSelection(value.selection) };
});
export function readDesignSelection(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20_000) throw new Error('Invalid design selection.');
  return value.map((id) => string(id, 256));
}
const route = '/v1/features/design/tasks';
export const startDesignTask = defineFeatureOperation({
  id: 'design.task.start', method: 'POST', path: route, errors: {}, idempotency: 'non-idempotent',
  input: defineRuntimeCodec<DesignTaskStart>((input) => {
    const { ref, threadId, sessionId, canvasRequestId, clientId, documentId, selection } = designTaskRecord(input);
    return { sessionId: token(sessionId), canvasRequestId: canvasRequestId === undefined ? undefined : token(canvasRequestId), clientId: clientId === undefined ? undefined : string(clientId, 256), ref: readDesignDocument.input.parse(ref), documentId: string(documentId, 256),
      selection: readDesignSelection(selection), threadId: string(threadId, 256) };
  }), output: step,
});
export const replyDesignTask = defineFeatureOperation({
  id: 'design.task.reply', method: 'POST', path: route + '/reply', errors: {}, idempotency: 'non-idempotent',
  input: defineRuntimeCodec<DesignTaskReply>((input) => {
    const { sessionId, id, result } = designTaskRecord(input);
    const { content, image, failed, plan } = designTaskRecord(result);
    if (image !== undefined && (typeof image !== 'string' || image.length > 8_000_000 || !image.startsWith('data:image/png;base64,'))) {
      throw new Error('Invalid design preview image.');
    }
    const mutation = plan === undefined ? undefined : designTaskRecord(plan);
    if (mutation && (!Array.isArray(mutation.edits) || mutation.edits.length > maxDesignTaskEdits)) throw new Error('Invalid design command batch.');
    return { sessionId: token(sessionId), id: token(id), result: { content: string(content, 200_000), image, failed: failed === true,
      plan: mutation && { revision: string(mutation.revision, 256), edits: (mutation.edits as unknown[]).map(parseDesignEdit) } } };
  }), output: step,
});
export const watchDesignCommand = defineFeatureOperation({
  id: 'design.task.watch-command', method: 'POST', path: route + '/watch-command', errors: {}, idempotency: 'idempotent',
  input: defineRuntimeCodec<DesignCommandKey>((input) => {
    const { sessionId, id } = designTaskRecord(input);
    return { sessionId: token(sessionId), id: token(id) };
  }), output: defineRuntimeCodec<null>(() => null),
});
export const bindDesignInput = defineFeatureOperation({
  id: 'design.task.bind-input', method: 'POST', path: route + '/bind-input', errors: {}, idempotency: 'idempotent',
  input: defineRuntimeCodec<DesignInputBinding>((input) => {
    const { sessionId, clientId, selection } = designTaskRecord(input);
    return { sessionId: token(sessionId), clientId: string(clientId, 256), selection: readDesignSelection(selection) };
  }), output: defineRuntimeCodec<null>(() => null),
});
export const stopDesignTask = defineFeatureOperation({
  id: 'design.task.stop', method: 'POST', path: route + '/stop', errors: {}, idempotency: 'idempotent',
  input: defineRuntimeCodec((input) => ({ sessionId: token(designTaskRecord(input).sessionId) })),
  output: defineRuntimeCodec<null>((value) => { if (value !== null) throw new Error('Invalid stop result.'); return null; }),
});

export interface DesignTurnHost {
  list(owner: DesignConversationOwner): Promise<DesignConversation[]>;
  create(owner: DesignConversationOwner): Promise<DesignConversation>;
  resolveOwnedRoot(threadId: string, owner: DesignConversationOwner): Promise<string | undefined>;
  cancel(threadId: string, expectedTurnId?: string): Promise<void>;
}
export interface DesignToolService {
  definitions: RuntimeToolDefinition[];
  chatCanvasRole(threadId: string, turnId?: string): 'owner' | 'participant' | undefined;
  captureSelection(threadId: string, clientId: string): RuntimeEditorSelection | undefined;
  restoreSelection(threadId: string, clientId: string, selection: RuntimeEditorSelection): void;
  join(parentThreadId: string, agent: DesignAgent, parentTurnId?: string): void;
  leave(threadId: string, turnId: string): Promise<void>;
  scope(threadId: string, turnId?: string, inputClientId?: string): { kind: 'document' | 'selection'; root: string; path: string } | undefined;
  execute(threadId: string, name: DesignToolName, args: unknown, signal: AbortSignal, turnId?: string, policy?: DesignToolPolicy): Promise<{
    content: string; attachments?: RuntimeMessage['attachments']; containsExternalContext: true;
  }>;
}
export const designTurnHostCapability = defineCapability<DesignTurnHost>({
  id: 'design.turn-host', description: 'Run a design task in a dedicated agent conversation.',
});
export const designToolsCapability = defineCapability<{ editor: DesignToolService; chat: ChatDesignTools }>({
  id: 'design.tools', description: 'Tools scoped to a live design editor task.',
});
