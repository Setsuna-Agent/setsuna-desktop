import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntimeFactory } from '../../../src/runtime/runtime-factory.js';
import {
  cleanupRuntimeSideConversations,
  createRuntimeSideConversation,
} from '../../../src/runtime/use-cases/side-conversation.js';

describe('side conversations', () => {
  it('captures hidden model context without interrupting or listing the primary turn', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-side-conversation-test-'));
    const runtime = createRuntimeFactory({ dataDir });
    try {
      await runtime.threadStore.recover();
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

      const side = await createRuntimeSideConversation(runtime, parent.id);

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

      await cleanupRuntimeSideConversations(runtime);
      await expect(runtime.threadStore.getThread(side.id)).resolves.toBeNull();
      await expect(runtime.threadStore.getThread(parent.id)).resolves.not.toBeNull();
      await expect(access(sideEnvironment.workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await runtime.extensionManager.shutdown();
      await runtime.mcpConnections.shutdown();
      await runtime.networkProxyFetch.close();
      await runtime.nativeBridge.close();
      await runtime.threadStore.close();
    }
  });
});
