import type { RuntimeEvent, RuntimeThread } from '@setsuna-desktop/contracts';
import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../src/adapters/event/in-memory-event-bus.js';
import { handleSse, runtimeEventStreamExperimentalApi } from '../../src/server/sse.js';
import type { RuntimeFactory } from '../../src/server/types.js';

describe('runtime SSE', () => {
  it('strips experimental SWE notification fields by default', async () => {
    const { output } = await renderSweSse([commandApprovalRequestedEvent()]);

    expect(output()).toContain('"method":"item/commandExecution/requestApproval"');
    expect(output()).not.toContain('additionalPermissions');
  });

  it('keeps experimental SWE notification fields when experimentalApi is enabled', async () => {
    const { output } = await renderSweSse([commandApprovalRequestedEvent()], true);

    expect(output()).toContain('"method":"item/commandExecution/requestApproval"');
    expect(output()).toContain('additionalPermissions');
  });

  it('parses the experimentalApi event stream flag', () => {
    expect(runtimeEventStreamExperimentalApi('true')).toBe(true);
    expect(runtimeEventStreamExperimentalApi('1')).toBe(true);
    expect(runtimeEventStreamExperimentalApi('false')).toBe(false);
    expect(runtimeEventStreamExperimentalApi(null)).toBe(false);
  });

  it('buffers events published while historical replay is loading', async () => {
    const eventBus = new InMemoryEventBus();
    const event = commandApprovalRequestedEvent();
    const { output } = await renderSweSse([], false, {
      eventBus,
      beforeHistoryReturns: () => eventBus.publish(event),
    });

    expect(output()).toContain('"method":"item/commandExecution/requestApproval"');
  });

  it('sends a snapshot resync when the requested runtime sequence was pruned', async () => {
    const chunks: string[] = [];
    const response = writableResponse(chunks);
    const thread = threadSnapshot(12);
    const runtime = {
      threadStore: {
        replayEvents: async () => ({
          events: [],
          latestSeq: 12,
          retainedFromSeq: 9,
          requiresResync: true,
        }),
        getThread: async () => thread,
      },
      eventBus: { subscribe: () => () => undefined },
    } as unknown as RuntimeFactory;

    await handleSse({
      format: 'runtime',
      response,
      threadId: thread.id,
      sinceSeq: 3,
      runtime,
    });

    expect(chunks.join('')).toContain('event: runtime-resync');
    expect(chunks.join('')).toContain('"requestedSinceSeq":3');
    expect(chunks.join('')).toContain('"lastSeq":12');
  });
});

async function renderSweSse(
  events: RuntimeEvent[],
  experimentalApi = false,
  options: { eventBus?: InMemoryEventBus; beforeHistoryReturns?: () => void } = {},
): Promise<{ output: () => string }> {
  const chunks: string[] = [];
  const response = writableResponse(chunks);
  const runtime = {
    threadStore: {
      listEvents: async () => {
        options.beforeHistoryReturns?.();
        return events;
      },
    },
    eventBus: options.eventBus ?? { subscribe: () => () => undefined },
  } as unknown as RuntimeFactory;

  await handleSse({
    experimentalApi,
    format: 'swe',
    response,
    threadId: 'thread_1',
    sinceSeq: 0,
    runtime,
  });

  return { output: () => chunks.join('') };
}

function writableResponse(chunks: string[]): ServerResponse {
  const response = {
    writeHead: () => response,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    on: () => response,
    off: () => response,
    once: () => response,
    destroy: () => response,
  } as unknown as ServerResponse;
  return response;
}

function threadSnapshot(lastSeq: number): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    lastSeq,
  };
}

function commandApprovalRequestedEvent(): RuntimeEvent {
  return {
    id: 'event_1',
    seq: 1,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'approval.requested',
    createdAt: '2026-06-27T00:00:00.000Z',
    payload: {
      approval: {
        id: 'approval_1',
        threadId: 'thread_1',
        turnId: 'turn_1',
        toolCallId: 'call_1',
        toolName: 'exec_command',
        reason: 'Need extra access.',
        argumentsPreview: '{"cmd":"cat README.md","workdir":"/work"}',
        additionalPermissions: {
          network: { enabled: true },
          file_system: { read: ['/work/allowed'] },
        },
        status: 'pending',
        createdAt: '2026-06-27T00:00:00.000Z',
      },
    },
  };
}
