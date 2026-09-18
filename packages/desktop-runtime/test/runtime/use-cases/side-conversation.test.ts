import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModelRequest, ModelStreamEvent, RuntimeMessage } from '@setsuna-desktop/contracts';
import {
  cleanupRuntimeSideConversations,
  createRuntimeSideConversation,
} from '@setsuna-desktop/feature-side-conversation/runtime';
import { createSideConversationRuntimeHost } from '../../../src/composition/side-conversation-runtime-host.js';
import { createRuntimeFactory } from '../../../src/runtime/runtime-factory.js';
import { copyRuntimeMessagesToThread } from '../../../src/runtime/use-cases/thread-copy.js';
import { deleteRuntimeThread } from '../../../src/runtime/use-cases/thread-operations.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { materializeRuntimeContextCompaction } from '../../../src/loop/context/context-compaction.js';
import { ContextWindowConfigStore } from '../../support/agent-loop/shared.js';

describe('side conversations', () => {
  it('copies nested native checkpoints as independent hidden history and can compact the side snapshot', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-side-native-compaction-'));
    const runtime = createRuntimeFactory({ dataDir });
    try {
      await runtime.threadStore.recover();
      const parent = await runtime.threadStore.createThread({ title: 'Native history' });
      const original = ['Original requirement', 'Verified implementation', 'Pending validation'].map((content, index): RuntimeMessage => ({
        id: `original_${index}`, role: index === 1 ? 'assistant' : 'user', content: `${content} ${'detail '.repeat(3_000)}`,
        createdAt: parent.createdAt, status: 'complete',
      }));
      const first = nativeSnapshot(original.slice(0, 2), 'first');
      const second = nativeSnapshot([...first.messages, original[2]!], 'second');
      await runtime.threadStore.appendEvent(parent.id, {
        id: 'native_history', threadId: parent.id, type: 'thread.context_compacted', createdAt: parent.createdAt,
        payload: second,
      });
      const before = await runtime.threadStore.getThread(parent.id);
      const side = await createRuntimeSideConversation(createSideConversationRuntimeHost(runtime), parent.id);
      expect(side.messages.filter((message) => message.id.startsWith('original_')))
        .toMatchObject(original.map((message) => ({ ...message, visibility: 'model' })));
      expect(side.messages.every((message) => message.visibility === 'model')).toBe(true);
      expect(side.messages.some((message) => message.contextCompaction?.nativeSourceMessageIds)).toBe(false);
      expect(side.messageCount).toBe(0);

      const requests: ModelRequest[] = [];
      const loop = new AgentLoop({
        threadStore: runtime.threadStore, eventBus: runtime.eventBus, clock: runtime.clock, ids: runtime.ids,
        configStore: new ContextWindowConfigStore(16_000),
        modelClient: { stream: async function* (request): AsyncGenerator<ModelStreamEvent> {
          requests.push(request);
          yield { type: 'text_delta', text: 'Preserved requirement and verified implementation; validation remains.' };
          yield { type: 'done', finishReason: 'stop' };
        } },
      });
      const compacted = await loop.compactThreadContext(side.id);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.messages.map((message) => message.content).join('\n')).toContain('Original requirement');
      expect(compacted.messages.some((message) => message.contextCompaction?.source === 'local')).toBe(true);
      expect(await runtime.threadStore.getThread(parent.id)).toEqual(before);
    } finally {
      await runtime.extensionManager.shutdown();
      await runtime.networkProxyFetch.close();
      await runtime.nativeBridge.close();
      await runtime.threadStore.close();
    }
  });

  it('retains and releases stored tool results through a real fork lifecycle', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-fork-test-'));
    const runtime = createRuntimeFactory({ dataDir });
    try {
      await runtime.threadStore.recover();
      const parent = await runtime.threadStore.createThread({ title: 'Fork parent' });
      await runtime.toolResultStore.save({
        resultId: 'tool_result_fork_lifecycle',
        threadId: parent.id,
        toolCallId: 'call_fork_lifecycle',
        toolName: 'workspace_read_file',
        fullText: 'fork lifecycle output',
        originalEstimatedTokens: 20_000,
        visibleTokenLimit: 10_000,
        locallyTruncated: false,
      });
      await runtime.threadStore.appendEvent(parent.id, {
        id: 'event_fork_source',
        threadId: parent.id,
        type: 'message.created',
        createdAt: '2026-08-18T00:00:00.000Z',
        payload: {
          message: {
            id: 'msg_fork_source',
            role: 'tool',
            toolCallId: 'call_fork_lifecycle',
            toolName: 'workspace_read_file',
            content: 'bounded fork output',
            toolResultRef: {
              resultId: 'tool_result_fork_lifecycle',
              originalEstimatedTokens: 20_000,
              visibleTokens: 10_000,
              visibleTokenLimit: 10_000,
            },
            createdAt: '2026-08-18T00:00:00.000Z',
            status: 'complete',
          },
        },
      });
      const source = await runtime.threadStore.getThread(parent.id);
      const fork = await runtime.threadStore.createThread({
        title: 'Fork child',
        forkedFromId: parent.id,
      });
      await copyRuntimeMessagesToThread(runtime, parent.id, fork.id, source?.messages ?? []);

      await expect(runtime.toolResultStore.read(
        fork.id,
        'tool_result_fork_lifecycle',
        0,
        1_000,
      )).resolves.toMatchObject({ content: 'fork lifecycle output' });

      await deleteRuntimeThread(runtime, fork.id);
      await expect(runtime.toolResultStore.read(
        fork.id,
        'tool_result_fork_lifecycle',
        0,
        1_000,
      )).resolves.toBeNull();
      await expect(runtime.toolResultStore.read(
        parent.id,
        'tool_result_fork_lifecycle',
        0,
        1_000,
      )).resolves.toMatchObject({ content: 'fork lifecycle output' });
    } finally {
      await runtime.extensionManager.shutdown();
      await runtime.networkProxyFetch.close();
      await runtime.nativeBridge.close();
      await runtime.threadStore.close();
    }
  });

  it('captures hidden model context without interrupting or listing the primary turn', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-side-conversation-test-'));
    const runtime = createRuntimeFactory({ dataDir });
    try {
      await runtime.threadStore.recover();
      const sideConversationHost = createSideConversationRuntimeHost(runtime);
      const project = await runtime.workspaceProjects.addProject({ name: 'Portable project' });
      const parent = await runtime.threadStore.createThread({ projectId: project.id });
      await runtime.threadStore.appendEvent(parent.id, {
        id: 'event_parent_turn_started',
        threadId: parent.id,
        turnId: 'turn_parent_active',
        type: 'turn.started',
        createdAt: '2026-08-18T00:00:00.000Z',
        payload: { input: 'Implement the primary task.' },
      });
      await runtime.threadStore.appendEvent(parent.id, {
        id: 'event_parent_developer',
        threadId: parent.id,
        type: 'message.created',
        createdAt: '2026-08-18T00:00:00.500Z',
        payload: {
          message: {
            id: 'msg_parent_developer',
            role: 'developer',
            content: 'Continue the primary task after copying this message.',
            createdAt: '2026-08-18T00:00:00.500Z',
            status: 'complete',
          },
        },
      });
      await runtime.threadStore.appendEvent(parent.id, {
        id: 'event_parent_user',
        threadId: parent.id,
        turnId: 'turn_parent_active',
        type: 'message.created',
        createdAt: '2026-08-18T00:00:01.000Z',
        payload: {
          message: {
            id: 'msg_parent_user',
            turnId: 'turn_parent_active',
            role: 'user',
            content: 'Implement the primary task.',
            createdAt: '2026-08-18T00:00:01.000Z',
            status: 'complete',
          },
        },
      });
      await runtime.threadStore.appendEvent(parent.id, {
        id: 'event_parent_assistant',
        threadId: parent.id,
        turnId: 'turn_parent_active',
        type: 'message.created',
        createdAt: '2026-08-18T00:00:02.000Z',
        payload: {
          message: {
            id: 'msg_parent_assistant',
            turnId: 'turn_parent_active',
            role: 'assistant',
            content: 'Partial primary response',
            createdAt: '2026-08-18T00:00:02.000Z',
            status: 'streaming',
          },
        },
      });
      await runtime.toolResultStore.save({
        resultId: 'tool_result_parent_snapshot',
        threadId: parent.id,
        toolCallId: 'call_parent_snapshot',
        toolName: 'workspace_read_file',
        fullText: 'full inherited tool output',
        originalEstimatedTokens: 20_000,
        visibleTokenLimit: 10_000,
        locallyTruncated: false,
      });
      await runtime.threadStore.appendEvent(parent.id, {
        id: 'event_parent_tool_result',
        threadId: parent.id,
        turnId: 'turn_parent_active',
        type: 'message.created',
        createdAt: '2026-08-18T00:00:02.500Z',
        payload: {
          message: {
            id: 'msg_parent_tool_result',
            turnId: 'turn_parent_active',
            role: 'tool',
            toolCallId: 'call_parent_snapshot',
            toolName: 'workspace_read_file',
            content: 'bounded inherited tool output',
            toolResultRef: {
              resultId: 'tool_result_parent_snapshot',
              originalEstimatedTokens: 20_000,
              visibleTokens: 10_000,
              visibleTokenLimit: 10_000,
            },
            createdAt: '2026-08-18T00:00:02.500Z',
            status: 'complete',
          },
        },
      });
      await runtime.threadStore.appendEvent(parent.id, {
        id: 'event_parent_transcript_only',
        threadId: parent.id,
        type: 'message.created',
        createdAt: '2026-08-18T00:00:03.000Z',
        payload: {
          message: {
            id: 'msg_parent_transcript_only',
            role: 'assistant',
            content: 'Compacted transcript only',
            createdAt: '2026-08-18T00:00:03.000Z',
            status: 'complete',
            visibility: 'transcript',
          },
        },
      });

      const side = await createRuntimeSideConversation(sideConversationHost, parent.id);

      expect(side).toMatchObject({
        kind: 'side',
        forkedFromId: parent.id,
        projectId: project.id,
        memoryMode: 'disabled',
      });
      expect(side.activeTurnId ?? null).toBeNull();
      expect(side.messages.every((message) => message.visibility === 'model')).toBe(true);
      expect(side.messages.map((message) => message.id)).toEqual(expect.arrayContaining([
        'msg_parent_user',
        'msg_parent_assistant',
      ]));
      expect(side.messages.map((message) => message.id)).not.toContain('msg_parent_transcript_only');
      expect(side.messages.find((message) => message.id === 'msg_parent_assistant')).toMatchObject({
        status: 'complete',
      });
      await expect(runtime.toolResultStore.read(
        side.id,
        'tool_result_parent_snapshot',
        0,
        1_000,
      )).resolves.toMatchObject({ content: 'full inherited tool output' });
      const snapshotStartIndex = side.messages.findIndex(
        (message) => message.content === '<primary_conversation_snapshot>',
      );
      const snapshotEndIndex = side.messages.findIndex(
        (message) => message.content.startsWith('</primary_conversation_snapshot>'),
      );
      expect(snapshotStartIndex).toBeGreaterThanOrEqual(0);
      expect(side.messages.findIndex((message) => message.id === 'msg_parent_user'))
        .toBeGreaterThan(snapshotStartIndex);
      expect(side.messages.findIndex((message) => message.id === 'msg_parent_assistant'))
        .toBeLessThan(snapshotEndIndex);
      expect(snapshotEndIndex).toBeGreaterThan(snapshotStartIndex);
      const inheritedDeveloperIndex = side.messages.findIndex(
        (message) => message.id === 'msg_parent_developer',
      );
      const lastDeveloperIndex = side.messages.reduce(
        (lastIndex, message, index) => message.role === 'developer' ? index : lastIndex,
        -1,
      );
      expect(inheritedDeveloperIndex).toBeGreaterThan(snapshotStartIndex);
      expect(lastDeveloperIndex).toBeGreaterThan(inheritedDeveloperIndex);
      expect(side.messages[lastDeveloperIndex]?.content)
        .toContain('are copied from the primary conversation');
      await expect(runtime.threadStore.getThread(parent.id)).resolves.toMatchObject({
        activeTurnId: 'turn_parent_active',
      });
      await expect(runtime.threadStore.listThreads({ includeArchived: true })).resolves.toEqual([
        expect.objectContaining({ id: parent.id }),
      ]);
      await expect(runtime.threadStore.listThreads({ includeArchived: true, includeSide: true }))
        .resolves.toHaveLength(2);

      const sideEnvironment = await runtime.environmentResolver.resolve({
        projectId: side.projectId,
        threadId: side.id,
        threadCreatedAt: side.createdAt,
      });
      await expect(access(sideEnvironment.workspaceRoot)).resolves.toBeUndefined();

      await cleanupRuntimeSideConversations(sideConversationHost);
      await expect(runtime.threadStore.getThread(side.id)).resolves.toBeNull();
      await expect(runtime.threadStore.getThread(parent.id)).resolves.not.toBeNull();
      await expect(runtime.toolResultStore.read(
        side.id,
        'tool_result_parent_snapshot',
        0,
        1_000,
      )).resolves.toBeNull();
      await expect(runtime.toolResultStore.read(
        parent.id,
        'tool_result_parent_snapshot',
        0,
        1_000,
      )).resolves.toMatchObject({ content: 'full inherited tool output' });
      await expect(access(sideEnvironment.workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await runtime.extensionManager.shutdown();
      await runtime.networkProxyFetch.close();
      await runtime.nativeBridge.close();
      await runtime.threadStore.close();
    }
  });
});

function nativeSnapshot(messages: RuntimeMessage[], id: string) {
  return materializeRuntimeContextCompaction({
    candidate: {
      autoCompactTokenLimit: 54_400, maxContextTokens: 64_000, maxContextTokensK: 64,
      historyTokens: 20_000, originalTokens: 20_000, reservedTokens: 0, targetContextTokens: 10_000,
      olderMessages: messages, pinnedMessages: [], recentMessages: [], triggerScopes: ['manual'],
    },
    id, createdAt: '2026-09-17T00:00:00.000Z', source: 'remote', summary: 'Opaque provider checkpoint',
    nativeSourceMessageIds: messages.filter((message) => message.visibility !== 'transcript').map((message) => message.id),
    providerMetadata: {
      schemaVersion: 3,
      source: { providerId: 'native', providerKind: 'openai-responses', model: 'model', endpointFingerprint: 'a'.repeat(64) },
      openAiResponsesCompaction: { items: [{ type: 'compaction', encrypted_content: 'opaque-state' }] },
    },
  });
}
