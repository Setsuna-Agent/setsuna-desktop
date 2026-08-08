import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../src/events.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeThread } from '../src/threads.js';

describe('thread event tool-run projection', () => {
  it('separates streamed tool preparation from actual execution', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [{
        id: 'msg_1',
        role: 'assistant',
        turnId: 'turn_1',
        content: '',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'streaming',
      }],
    };
    const preview: RuntimeEvent = {
      id: 'event_preview',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.preview',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        argumentsPreview: '{"file_path":"src/generated.ts"',
        argumentsLength: 34,
      },
    };
    const started: RuntimeEvent = {
      id: 'event_started',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.started',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        argumentsPreview: '{"file_path":"src/generated.ts","content":"export {};"}',
        plugin: { id: 'demo-plugin', name: 'Demo Plugin', icon: 'demo' },
      },
    };

    const preparing = applyRuntimeEventToThread(thread, preview);
    const executing = applyRuntimeEventToThread(preparing, started);

    expect(preparing.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'running',
      phase: 'preparing',
      argumentsLength: 34,
      preparedAt: '2026-06-26T00:00:01.000Z',
    });
    expect(executing.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'running',
      phase: 'executing',
      plugin: { id: 'demo-plugin', name: 'Demo Plugin', icon: 'demo' },
      preparedAt: '2026-06-26T00:00:01.000Z',
      startedAt: '2026-06-26T00:00:02.000Z',
    });
  });

  it('appends tool output deltas to the matching assistant tool run', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [
        {
          id: 'msg_1',
          role: 'assistant',
          turnId: 'turn_1',
          content: '',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'streaming',
        },
      ],
    };
    const started: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.started',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        argumentsPreview: '{"command":"pnpm test"}',
        source: 'agent',
      },
    };
    const firstDelta: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.output_delta',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        delta: 'stdout: hello\n',
        stream: 'stdout',
        source: 'agent',
      },
    };
    const secondDelta: RuntimeEvent = {
      id: 'event_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.output_delta',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        delta: 'stdout: world\n',
        stream: 'stdout',
        source: 'agent',
      },
    };

    const updated = [started, firstDelta, secondDelta].reduce(applyRuntimeEventToThread, thread);

    expect(updated.lastSeq).toBe(3);
    expect(updated.messages[0].toolRuns).toEqual([
      expect.objectContaining({
        id: 'call_1',
        name: 'run_shell_command',
        source: 'agent',
        status: 'running',
        argumentsPreview: '{"command":"pnpm test"}',
        resultPreview: 'stdout: hello\nstdout: world\n',
      }),
    ]);
  });

  it('clears the failed first-attempt output when a sandbox bypass retry awaits approval', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [{
        id: 'msg_1',
        role: 'assistant',
        turnId: 'turn_1',
        content: '',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'streaming',
        toolRuns: [{
          id: 'call_1',
          name: 'exec_command',
          status: 'running',
          resultPreview: 'Error: spawn EPERM\nfull stack trace',
        }],
      }],
    };
    const approvalRequested: RuntimeEvent = {
      id: 'event_approval',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.requested',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        approval: {
          id: 'approval_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          toolCallId: 'call_1',
          toolName: 'exec_command',
          reason: 'The OS sandbox blocked the first exec_command attempt. Approve retry without the OS sandbox.',
          argumentsPreview: '{"cmd":"pnpm dev"}',
          retryKind: 'sandbox_bypass',
          status: 'pending',
          createdAt: '2026-06-26T00:00:01.000Z',
        },
      },
    };

    const updated = applyRuntimeEventToThread(thread, approvalRequested);

    expect(updated.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'pending_approval',
      resultPreview: '',
      approvalRetryKind: 'sandbox_bypass',
    });
  });

  it('uses tool completion content as the final preview after streaming deltas', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [
        {
          id: 'msg_1',
          role: 'assistant',
          turnId: 'turn_1',
          content: '',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'streaming',
          toolRuns: [
            {
              id: 'call_1',
              name: 'run_shell_command',
              status: 'running',
              resultPreview: 'stdout: partial\n',
            },
          ],
        },
      ],
    };
    const completed: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.completed',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        status: 'success',
        content: '$ pnpm test\nstdout: done\nexit: 0',
        data: { artifact: { id: 'artifact_call_1', kind: 'file', path: 'report.pdf' } },
        durationMs: 42,
      },
    };

    const updated = applyRuntimeEventToThread(thread, completed);

    expect(updated.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'success',
      resultPreview: '$ pnpm test\nstdout: done\nexit: 0',
      data: { artifact: { id: 'artifact_call_1', kind: 'file', path: 'report.pdf' } },
      durationMs: 42,
    });
  });

  it('preserves structured completion previews instead of replacing them with model-facing content', () => {
    const structuredPreview = JSON.stringify({
      diff: { path: 'src/theme.css', action: 'Edited', additions: 4, deletions: 2, lines: [] },
    });
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [{
        id: 'msg_1',
        role: 'assistant',
        turnId: 'turn_1',
        content: '',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'streaming',
        toolRuns: [{ id: 'call_1', name: 'write_file', status: 'running' }],
      }],
    };
    const completed: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.completed',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        status: 'success',
        content: 'Updated src/theme.css.',
        resultPreview: structuredPreview,
      },
    };

    const updated = applyRuntimeEventToThread(thread, completed);

    expect(updated.messages[0].toolRuns?.[0]?.resultPreview).toBe(structuredPreview);
  });

  it('marks approved tool runs as running while the tool continues', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [
        {
          id: 'msg_1',
          role: 'assistant',
          turnId: 'turn_1',
          content: '',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'streaming',
          toolRuns: [
            {
              id: 'call_1',
              name: 'workspace_write_file',
              status: 'pending_approval',
              approvalId: 'approval_1',
              approvalStatus: 'pending',
              argumentsPreview: '{"path":"merge_sort.py"}',
            },
          ],
        },
      ],
    };
    const event: RuntimeEvent = {
      id: 'event_approval',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.resolved',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        approvalId: 'approval_1',
        decision: 'approve',
      },
    };

    const updated = applyRuntimeEventToThread(thread, event);

    expect(updated.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'running',
      approvalStatus: 'approved',
    });
  });

  it('projects MCP elicitation payloads onto the active tool run', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [{
        id: 'msg_1',
        role: 'assistant',
        turnId: 'turn_1',
        content: '',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'streaming',
        toolRuns: [{ id: 'call_1', name: 'mcp__profile__collect', status: 'running' }],
      }],
    };
    const event: RuntimeEvent = {
      id: 'event_elicitation',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.requested',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        approval: {
          id: 'approval_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          toolCallId: 'call_1',
          toolName: 'mcp__profile__collect',
          reason: 'Provide your profile.',
          argumentsPreview: '{"server":"profile","fields":["name"]}',
          status: 'pending',
          createdAt: '2026-06-26T00:00:01.000Z',
          elicitation: {
            mode: 'form',
            serverKey: 'profile',
            message: 'Provide your profile.',
            requestedSchema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
      },
    };

    const updated = applyRuntimeEventToThread(thread, event);

    expect(updated.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'pending_approval',
      approvalId: 'approval_1',
      elicitation: { mode: 'form', serverKey: 'profile' },
    });
  });

  it('projects structured user input requests onto the active tool run', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [{
        id: 'msg_1',
        role: 'assistant',
        turnId: 'turn_1',
        content: '',
        createdAt: '2026-07-15T00:00:00.000Z',
        status: 'streaming',
        toolRuns: [{ id: 'call_1', name: 'request_user_input', status: 'running' }],
      }],
    };
    const event: RuntimeEvent = {
      id: 'event_user_input',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.requested',
      createdAt: '2026-07-15T00:00:01.000Z',
      payload: {
        approval: {
          id: 'approval_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          toolCallId: 'call_1',
          toolName: 'request_user_input',
          reason: 'Choose a target.',
          argumentsPreview: '{"fields":["target"]}',
          status: 'pending',
          createdAt: '2026-07-15T00:00:01.000Z',
          userInput: {
            title: 'Target',
            message: 'Choose a target.',
            autoResolutionMs: 60_000,
            expiresAt: '2026-07-15T00:01:01.000Z',
            requestedSchema: {
              type: 'object',
              properties: { target: { type: 'string', oneOf: [{ const: 'staging', title: 'Staging' }] } },
              required: ['target'],
            },
          },
        },
      },
    };

    const updated = applyRuntimeEventToThread(thread, event);

    expect(updated.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'pending_approval',
      approvalId: 'approval_1',
      userInput: { title: 'Target', autoResolutionMs: 60_000 },
    });
  });
});
