import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import {
  McpElicitationCoordinator,
  secureElicitationUrl,
} from '../../../src/adapters/mcp/mcp-elicitation-coordinator.js';
import { RuntimeEventWriter } from '../../../src/loop/lifecycle/runtime-event-writer.js';
import type { Clock } from '../../../src/ports/clock.js';
import type { EventBus } from '../../../src/ports/event-bus.js';
import type { IdGenerator } from '../../../src/ports/id-generator.js';
import type { ThreadStore } from '../../../src/ports/thread-store.js';

describe('McpElicitationCoordinator', () => {
  it('persists the request but keeps validated form answers out of thread events', async () => {
    const harness = createHarness();
    const resultPromise = harness.coordinator.request('profile_server', {
      mode: 'form',
      message: 'Provide your profile.',
      requestedSchema: {
        type: 'object',
        properties: {
          displayName: { type: 'string', minLength: 2 },
          privateCode: { type: 'string' },
        },
        required: ['displayName'],
      },
    }, executionContext());

    await expect.poll(async () => (await harness.gate.listApprovals()).approvals.length).toBe(1);
    const approval = (await harness.gate.listApprovals()).approvals[0];
    await expect(harness.gate.answerApproval(approval.id, {
      decision: 'approve',
      elicitationResponse: { action: 'accept', content: { displayName: 'x' } },
    })).rejects.toThrow("field 'displayName' is too short");
    await harness.gate.answerApproval(approval.id, {
      decision: 'approve',
      elicitationResponse: {
        action: 'accept',
        content: { displayName: 'Setsuna', privateCode: 'never-persist-this' },
      },
    });

    await expect(resultPromise).resolves.toEqual({
      action: 'accept',
      content: { displayName: 'Setsuna', privateCode: 'never-persist-this' },
    });
    expect(harness.events.some((event) => event.type === 'approval.requested')).toBe(true);
    expect(harness.events.some((event) => event.type === 'approval.resolved')).toBe(true);
    expect(JSON.stringify(harness.events)).not.toContain('never-persist-this');
    await expect(harness.gate.listApprovals()).resolves.toEqual({ approvals: [] });
  });

  it('redacts URL query data from persisted approvals and rejects unsafe URLs', async () => {
    const harness = createHarness();
    const resultPromise = harness.coordinator.request('auth_server', {
      mode: 'url',
      message: 'Authorize access.',
      elicitationId: 'elicit_1',
      url: 'https://example.com/authorize?one_time_token=secret#fragment',
    }, executionContext());

    await expect.poll(async () => (await harness.gate.listApprovals()).approvals.length).toBe(1);
    const approval = (await harness.gate.listApprovals()).approvals[0];
    expect(approval.elicitation).toMatchObject({
      mode: 'url',
      displayUrl: 'https://example.com/authorize',
    });
    expect(JSON.stringify(harness.events)).not.toContain('one_time_token');
    await harness.gate.answerApproval(approval.id, {
      decision: 'reject',
      elicitationResponse: { action: 'decline' },
    });
    await expect(resultPromise).resolves.toEqual({ action: 'decline' });

    expect(() => secureElicitationUrl('http://example.com/authorize')).toThrow('HTTPS or loopback HTTP');
    expect(() => secureElicitationUrl('https://user:password@example.com/authorize')).toThrow('embedded credentials');
    expect(secureElicitationUrl('http://127.0.0.1:3000/authorize').origin).toBe('http://127.0.0.1:3000');
  });
});

function executionContext() {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    toolCallId: 'call_1',
    toolName: 'mcp__server__tool',
  };
}

function createHarness() {
  let sequence = 0;
  const events: RuntimeEvent[] = [];
  const clock: Clock = { now: () => new Date(Date.UTC(2026, 6, 15, 0, 0, sequence)) };
  const ids: IdGenerator = { id: (prefix) => `${prefix}_${++sequence}` };
  const gate = new InMemoryApprovalGate(clock, ids);
  const threadStore = {
    appendEvent: async (_threadId: string, event: Omit<RuntimeEvent, 'seq'>) => {
      const saved = { ...event, seq: events.length + 1 } as RuntimeEvent;
      events.push(saved);
      return saved;
    },
  } as ThreadStore;
  const eventBus = {
    publish: () => undefined,
    subscribe: () => () => undefined,
  } satisfies EventBus;
  const eventWriter = new RuntimeEventWriter(threadStore, eventBus);
  return {
    coordinator: new McpElicitationCoordinator(gate, eventWriter, clock, ids),
    events,
    gate,
  };
}
