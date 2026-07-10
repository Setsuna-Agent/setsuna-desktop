import type { ServerResponse } from 'node:http';
import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { handleSse, runtimeEventStreamExperimentalApi } from './sse.js';
import type { RuntimeFactory } from './types.js';

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
});

async function renderSweSse(
  events: RuntimeEvent[],
  experimentalApi = false,
  options: { eventBus?: InMemoryEventBus; beforeHistoryReturns?: () => void } = {},
): Promise<{ output: () => string }> {
  const chunks: string[] = [];
  const response = {
    writeHead: () => response,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    on: () => response,
    destroy: () => response,
  } as unknown as ServerResponse;
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
