import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../src/events.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeThread } from '../src/threads.js';

describe('thread event model-state projection', () => {
  it('terminalizes active turn work when a runtime error ends the turn', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:01.000Z',
      archived: false,
      activeTurnId: 'turn_1',
      contextCompaction: {
        status: 'running',
        turnId: 'turn_1',
        startedAt: '2026-06-26T00:00:01.000Z',
        usedTokens: 217817,
      },
      messageCount: 1,
      lastMessagePreview: 'Inspecting the repository.',
      lastSeq: 2,
      turns: [{
        id: 'turn_1',
        startedAt: '2026-06-26T00:00:00.000Z',
        status: 'in_progress',
        items: [
          {
            id: 'item_tool',
            kind: 'tool_call',
            status: 'in_progress',
            toolCall: {
              id: 'call_exec',
              name: 'exec_command',
              arguments: '{"cmd":"echo pending"}',
            },
          },
          {
            id: 'item_complete',
            kind: 'agent_message',
            status: 'completed',
            content: 'Already complete.',
          },
        ],
      }],
      messages: [{
        id: 'msg_assistant',
        turnId: 'turn_1',
        role: 'assistant',
        content: 'Inspecting the repository.',
        createdAt: '2026-06-26T00:00:00.500Z',
        status: 'streaming',
        toolRuns: [
          {
            id: 'call_exec',
            name: 'exec_command',
            status: 'running',
            phase: 'preparing',
          },
          {
            id: 'call_approval',
            name: 'request_permissions',
            status: 'pending_approval',
            approvalStatus: 'pending',
          },
        ],
        hookRuns: [{
          id: 'hook_stop',
          turnId: 'turn_1',
          eventName: 'Stop',
          handlerType: 'command',
          status: 'running',
        }],
      }],
    };
    const failed: RuntimeEvent = {
      id: 'event_failed',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'runtime.error',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        code: 'turn_failed',
        message: 'Context compaction model request failed.',
      },
    };

    const projected = applyRuntimeEventToThread(thread, failed);

    expect(projected.contextCompaction).toBeUndefined();
    expect(projected.activeTurnId).toBeNull();
    expect(projected.turns?.[0]).toMatchObject({
      status: 'failed',
      completedAt: failed.createdAt,
      error: failed.payload.message,
      items: [
        { id: 'item_tool', status: 'failed' },
        { id: 'item_complete', status: 'completed' },
      ],
    });
    expect(projected.messages[0]).toMatchObject({
      status: 'error',
      completedAt: failed.createdAt,
      error: failed.payload.message,
      toolRuns: [
        {
          id: 'call_exec',
          status: 'error',
          phase: 'preparing',
          resultPreview: failed.payload.message,
          completedAt: failed.createdAt,
        },
        {
          id: 'call_approval',
          status: 'cancelled',
          approvalStatus: 'cancelled',
          approvalMessage: failed.payload.message,
          resultPreview: failed.payload.message,
          completedAt: failed.createdAt,
        },
      ],
      hookRuns: [{
        id: 'hook_stop',
        status: 'failed',
        message: failed.payload.message,
        completedAt: failed.createdAt,
      }],
    });
  });

  it('does not clear running context compaction for an unrelated terminal turn', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      activeTurnId: 'turn_compact',
      contextCompaction: {
        status: 'running',
        turnId: 'turn_compact',
        startedAt: '2026-06-26T00:00:01.000Z',
      },
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 1,
      turns: [{ id: 'turn_compact', items: [], status: 'in_progress' }],
      messages: [],
    };
    const unrelatedCompleted: RuntimeEvent = {
      id: 'event_shell_completed',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_shell',
      type: 'turn.completed',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: { taskKind: 'user_shell' },
    };

    const projected = applyRuntimeEventToThread(thread, unrelatedCompleted);

    expect(projected.contextCompaction).toMatchObject({ status: 'running', turnId: 'turn_compact' });
    expect(projected.activeTurnId).toBe('turn_compact');
  });

  it('keeps hook runs pending until a context compaction message exists for the turn', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
    };
    const started: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_compact',
      type: 'hook.started',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        id: 'hook_turn_compact_PreCompact_0',
        turnId: 'turn_compact',
        eventName: 'PreCompact',
        handlerType: 'command',
        status: 'running',
        matcher: 'manual',
      },
    };
    const completed: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_compact',
      type: 'hook.completed',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        id: 'hook_turn_compact_PreCompact_0',
        turnId: 'turn_compact',
        eventName: 'PreCompact',
        handlerType: 'command',
        status: 'completed',
        matcher: 'manual',
        entries: [{ kind: 'warning', text: 'pre compact warning' }],
      },
    };
    const compactedMessage = {
      id: 'msg_compact',
      turnId: 'turn_compact',
      role: 'user' as const,
      content: '<context_compaction_summary>hello</context_compaction_summary>',
      createdAt: '2026-06-26T00:00:03.000Z',
      status: 'complete' as const,
      contextCompaction: {
        compactedMessageCount: 1,
        compactedTokens: 128,
        keptRecentMessageCount: 0,
        maxContextTokensK: 256,
        originalMessageCount: 1,
        originalTokens: 512,
        triggerScopes: ['manual'],
      },
    };
    const compacted: RuntimeEvent = {
      id: 'event_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_compact',
      type: 'thread.context_compacted',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: {
        messages: [compactedMessage],
        notice: compactedMessage.contextCompaction,
      },
    };

    const pending = [started, completed].reduce(applyRuntimeEventToThread, thread);
    expect(pending.pendingHookRuns).toMatchObject([
      {
        eventName: 'PreCompact',
        status: 'completed',
        entries: [{ kind: 'warning', text: 'pre compact warning' }],
      },
    ]);

    const projected = applyRuntimeEventToThread(pending, compacted);
    expect(projected.pendingHookRuns).toBeUndefined();
    expect(projected.messages[0]).toMatchObject({
      id: 'msg_compact',
      hookRuns: [{
        eventName: 'PreCompact',
        status: 'completed',
        matcher: 'manual',
        entries: [{ kind: 'warning', text: 'pre compact warning' }],
      }],
    });
  });

  it('projects sampling step snapshots into the owning turn', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
    };
    const snapshot = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      threadLastSeq: 3,
      conversationMessageIds: ['msg_user'],
      messageIds: ['msg_system', 'msg_user'],
      inputMessageIds: ['msg_user'],
      toolNames: ['read_file'],
      advertisedToolNames: ['read_file'],
      toolRuntimes: [{
        name: 'read_file',
        source: 'host' as const,
        exposure: 'direct' as const,
        supportsParallel: true,
        waitsForRuntimeCancellation: true,
      }],
      toolChoice: 'auto' as const,
      toolEnvironment: {
        id: 'project_1',
        cwd: '/tmp/project',
        workspaceRoot: '/tmp/project',
        workspaceRoots: ['/tmp/project'],
        repository: { kind: 'git' as const, root: '/tmp', workspacePrefix: 'project' },
      },
      selectedSkills: [{ id: 'skill_1', name: 'Skill One' }],
      mcpServerKeys: ['filesystem'],
      mcpServerCount: 1,
      permissionProfile: 'workspace-write' as const,
      sandboxWorkspaceWrite: {
        writableRoots: ['/tmp/project'],
        readableRoots: ['/tmp/project'],
        deniedRoots: ['/tmp/project/.git'],
        deniedGlobPatterns: ['**/.env'],
        networkAccess: false,
      },
      contextWindow: {
        autoCompactTokenLimit: 850,
        compactionHash: 'sha256:abc',
        compactionSummaryMessageIds: ['msg_compact'],
        estimatedTokens: 128,
        maxContextTokens: 1000,
        maxContextTokensK: 1,
        messageCount: 2,
        tokensUntilCompaction: 722,
      },
      featureKeys: ['request_permissions_tool'],
      worldState: {
        activeProviderId: 'test',
        memoryEnabled: true,
        threadMessageCount: 1,
        threadUpdatedAt: '2026-06-26T00:00:00.000Z',
      },
    };

    const projected = applyRuntimeEventToThread(thread, {
      id: 'event_step_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.step_snapshot',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: { snapshot },
    });

    expect(projected.turns?.[0]?.stepSnapshots).toEqual([{
      createdAt: '2026-06-26T00:00:01.000Z',
      snapshot,
    }]);

    const renamed = applyRuntimeEventToThread(projected, {
      id: 'event_step_2',
      seq: 2,
      threadId: 'thread_1',
      type: 'thread.updated',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: { title: 'Renamed' },
    });
    expect(renamed.turns).toBe(projected.turns);
    expect(renamed.turns?.[0]).toBe(projected.turns?.[0]);

    const extended = applyRuntimeEventToThread(projected, {
      id: 'event_step_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.step_snapshot',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: { snapshot },
    });
    expect(extended.turns).not.toBe(projected.turns);
    expect(extended.turns?.[0]).not.toBe(projected.turns?.[0]);
    expect(extended.turns?.[0]?.stepSnapshots).toHaveLength(2);
    expect(projected.turns?.[0]?.stepSnapshots).toHaveLength(1);
  });

  it('projects item-based model stream state into the owning turn', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
    };
    const events: RuntimeEvent[] = [
      {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.started',
        createdAt: '2026-06-26T00:00:01.000Z',
        payload: { input: 'inspect', taskKind: 'regular' },
      },
      {
        id: 'event_2',
        seq: 2,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'item.started',
        createdAt: '2026-06-26T00:00:02.000Z',
        payload: {
          item: {
            id: 'item_agent_1',
            kind: 'agent_message',
            status: 'in_progress',
            transcriptMessageId: 'msg_assistant_1',
          },
        },
      },
      {
        id: 'event_3',
        seq: 3,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'item.delta',
        createdAt: '2026-06-26T00:00:03.000Z',
        payload: { itemId: 'item_agent_1', delta: 'Hello' },
      },
      {
        id: 'event_4',
        seq: 4,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'item.completed',
        createdAt: '2026-06-26T00:00:04.000Z',
        payload: {
          item: {
            id: 'item_agent_1',
            kind: 'agent_message',
            status: 'completed',
            transcriptMessageId: 'msg_assistant_1',
          },
        },
      },
      {
        id: 'event_5',
        seq: 5,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'plan.delta',
        createdAt: '2026-06-26T00:00:05.000Z',
        payload: { itemId: 'item_plan_1', delta: '1. Inspect state.' },
      },
      {
        id: 'event_6',
        seq: 6,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'reasoning.summary_delta',
        createdAt: '2026-06-26T00:00:06.000Z',
        payload: { itemId: 'item_reasoning_1', delta: 'Thinking briefly.', summaryIndex: 0 },
      },
      {
        id: 'event_7',
        seq: 7,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'safety.buffering',
        createdAt: '2026-06-26T00:00:07.000Z',
        payload: { buffering: { model: 'slow-model', fasterModel: 'fast-model', reasons: ['policy'], showBufferingUi: true } },
      },
      {
        id: 'event_8',
        seq: 8,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'model.verification',
        createdAt: '2026-06-26T00:00:08.000Z',
        payload: { verification: { model: 'slow-model', provider: 'setsuna', warnings: ['fallback'] } },
      },
      {
        id: 'event_9',
        seq: 9,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'token.count',
        createdAt: '2026-06-26T00:00:09.000Z',
        payload: {
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          modelContextWindow: 128000,
          tokensUntilCompaction: 64000,
        },
      },
      {
        id: 'event_10',
        seq: 10,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.diff',
        createdAt: '2026-06-26T00:00:10.000Z',
        payload: { unifiedDiff: 'diff --git a/a.txt b/a.txt' },
      },
      {
        id: 'event_10b',
        seq: 11,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.diff',
        createdAt: '2026-06-26T00:00:10.100Z',
        payload: { unifiedDiff: 'diff --git a/b.txt b/b.txt' },
      },
      {
        id: 'event_10c',
        seq: 12,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.diff',
        createdAt: '2026-06-26T00:00:10.200Z',
        payload: { unifiedDiff: 'diff --git a/a.txt b/a.txt' },
      },
      {
        id: 'event_11',
        seq: 13,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.completed',
        createdAt: '2026-06-26T00:00:11.000Z',
        payload: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      },
    ];

    const projected = events.reduce(applyRuntimeEventToThread, thread);

    expect(projected.activeTurnId).toBeNull();
    expect(projected.turns).toHaveLength(1);
    expect(projected.turns?.[0]).toMatchObject({
      id: 'turn_1',
      input: 'inspect',
      taskKind: 'regular',
      status: 'completed',
      startedAt: '2026-06-26T00:00:01.000Z',
      completedAt: '2026-06-26T00:00:11.000Z',
      diff: 'diff --git a/a.txt b/a.txt\n\ndiff --git a/b.txt b/b.txt',
      safetyBuffering: {
        model: 'slow-model',
        fasterModel: 'fast-model',
        reasons: ['policy'],
        showBufferingUi: true,
      },
      modelVerifications: [{ model: 'slow-model', provider: 'setsuna', warnings: ['fallback'] }],
      tokenCounts: [{
        createdAt: '2026-06-26T00:00:09.000Z',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        modelContextWindow: 128000,
        tokensUntilCompaction: 64000,
      }],
      items: [
        {
          id: 'item_agent_1',
          kind: 'agent_message',
          status: 'completed',
          content: 'Hello',
          transcriptMessageId: 'msg_assistant_1',
        },
        { id: 'item_plan_1', kind: 'plan', status: 'in_progress', content: '1. Inspect state.' },
        { id: 'item_reasoning_1', kind: 'reasoning', status: 'in_progress', content: 'Thinking briefly.' },
      ],
    });

    const renamed = applyRuntimeEventToThread(projected, {
      id: 'event_12',
      seq: 14,
      threadId: 'thread_1',
      type: 'thread.updated',
      createdAt: '2026-06-26T00:00:12.000Z',
      payload: { title: 'Renamed' },
    });
    expect(renamed.turns).toBe(projected.turns);
    expect(renamed.turns?.[0]).toBe(projected.turns?.[0]);

    const extended = applyRuntimeEventToThread(projected, {
      id: 'event_13',
      seq: 15,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'item.delta',
      createdAt: '2026-06-26T00:00:13.000Z',
      payload: { itemId: 'item_agent_1', delta: ' again' },
    });
    expect(extended.turns).not.toBe(projected.turns);
    expect(extended.turns?.[0]).not.toBe(projected.turns?.[0]);
    expect(extended.turns?.[0]?.items[0]?.content).toBe('Hello again');
    expect(projected.turns?.[0]?.items[0]?.content).toBe('Hello');
  });
});
