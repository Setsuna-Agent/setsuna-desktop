import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { createGoalEnabledAgentLoop } from '../../support/agent-loop/goal-feature.js';
import { mkDataDir, waitForTestState } from '../../support/agent-loop/shared.js';

async function heldVerification() {
  const ids = new RandomIdGenerator();
  const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
  const thread = await store.createThread({ title: 'In-flight Goal verification' });
  let release!: () => void;
  const response = new Promise<void>(resolve => { release = resolve; });
  let verificationRequest: ModelRequest | undefined;
  let step = 0;
  const loop = createGoalEnabledAgentLoop({ ids, threadStore: store, eventBus: new InMemoryEventBus(), clock: systemClock,
    modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
      if (request.responseFormat?.name === 'goal_completion_verification') {
        verificationRequest = request;
        // Deliberately ignore abort until released: cancelling must not wait for the provider.
        await response;
        const input = JSON.parse(request.messages[1].content) as { sources: Array<{ id: string }> };
        yield { type: 'text_delta', text: JSON.stringify({ passed: true, checks: [{ requirement: 'Write an answer',
          passed: true, evidenceIds: [input.sources.at(-1)!.id], finding: 'Answer is present.' }], gaps: [] }) };
        yield { type: 'done', finishReason: 'stop' };
      } else if (++step === 1) {
        yield { type: 'text_delta', text: 'The requested answer.' };
        yield { type: 'tool_calls', toolCalls: [{ id: 'complete', name: 'update_goal', arguments: '{"status":"complete"}' }] };
        yield { type: 'done', finishReason: 'tool_calls' };
      } else {
        // Keep subsequent work pending so the test can inspect a rejected stale verdict.
        await new Promise<void>(resolve => {
          if (request.signal?.aborted) resolve();
          else request.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        request.signal?.throwIfAborted();
      }
    } },
  });
  await loop.setThreadGoal(thread.id, { objective: 'Write an answer.', status: 'active' });
  await waitForTestState(async () => verificationRequest, value => Boolean(value), () => 'Verifier did not start.');
  return { loop, store, thread, request: verificationRequest!, release };
}

describe('in-flight Goal verification', () => {
  it.each(['cancel', 'pause', 'clear'] as const)('allows %s before the verifier responds and discards its late verdict', async action => {
    const fixture = await heldVerification();
    const { loop, thread, store, request, release } = fixture;
    let finished = false;
    const mutation = (action === 'cancel' ? loop.cancelTurn(thread.id, loop.activeTurnId(thread.id)!)
      : action === 'pause' ? loop.setThreadGoal(thread.id, { status: 'paused' }) : loop.clearThreadGoal(thread.id))
      .then(() => { finished = true; });
    try {
      await waitForTestState(async () => finished, Boolean, () => `${action} is waiting for the verifier.`);
      expect(request.signal?.aborted).toBe(true);
      if (action === 'clear') expect(await loop.getThreadGoal(thread.id)).toBeNull();
      else expect(await loop.getThreadGoal(thread.id)).toMatchObject({ status: 'paused' });
    } finally {
      release();
      await mutation;
      await loop.shutdown();
    }
    const events = await store.listEvents(thread.id);
    expect(events.filter(event => event.type === 'feature.event' && event.eventType === 'goal.verification-recorded')).toEqual([]);
    expect((await store.getThread(thread.id))?.messages.some(message => message.goalMode?.kind === 'complete')).toBe(false);
    if (action === 'clear') expect(await loop.getThreadGoal(thread.id)).toBeNull();
    else expect(await loop.getThreadGoal(thread.id)).toMatchObject({ status: 'paused' });
  });

  it('rejects a stale verdict even when the objective is edited away and back', async () => {
    const { loop, thread, store, request, release } = await heldVerification();
    let edited = false;
    const mutation = (async () => {
      await loop.setThreadGoal(thread.id, { objective: 'A different deliverable.' });
      await loop.setThreadGoal(thread.id, { objective: 'Write an answer.' });
      edited = true;
    })();
    try {
      await waitForTestState(async () => edited, Boolean, () => 'Editing is waiting for the verifier.');
      expect(request.signal?.aborted).toBe(false);
      release();
      const events = await waitForTestState(() => store.listEvents(thread.id),
        records => records.some(event => event.type === 'tool.completed' && event.payload.toolName === 'update_goal'),
        () => 'Completion request did not settle.');
      const threadState = await store.getThread(thread.id);
      expect(threadState?.messages).toContainEqual(expect.objectContaining({ role: 'tool', toolName: 'update_goal',
        status: 'error', content: expect.stringContaining('Goal changed during completion verification') }));
      expect(events.filter(event => event.type === 'feature.event' && event.eventType === 'goal.verification-recorded')).toEqual([]);
      expect(await loop.getThreadGoal(thread.id)).toMatchObject({ objective: 'Write an answer.', status: 'active' });
    } finally {
      release();
      await mutation;
      await loop.shutdown();
    }
  });
});
