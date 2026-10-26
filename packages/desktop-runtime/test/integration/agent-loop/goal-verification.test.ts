import type { ModelStreamEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { createGoalEnabledAgentLoop } from '../../support/agent-loop/goal-feature.js';
import { mkDataDir, waitForTestState } from '../../support/agent-loop/shared.js';

describe('Goal verification and repair loop', () => {
  it('does not commit an approved completion when the final model response is truncated', async () => {
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await store.createThread({ title: 'Truncated final answer' });
    let step = 0;
    const loop = createGoalEnabledAgentLoop({ ids, threadStore: store, eventBus: new InMemoryEventBus(), clock: systemClock,
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        if (request.responseFormat?.name === 'goal_completion_verification') {
          const input = JSON.parse(request.messages[1].content) as { sources: Array<{ id: string }> };
          yield { type: 'text_delta', text: JSON.stringify({ passed: true,
            checks: [{ requirement: 'Write a short answer', passed: true, evidenceIds: [input.sources.at(-1)!.id], finding: 'Answer is present.' }], gaps: [] }) };
          yield { type: 'done', finishReason: 'stop' }; return;
        }
        if (++step === 1) {
          yield { type: 'text_delta', text: 'The requested answer.' };
          yield { type: 'tool_calls', toolCalls: [{ id: 'complete', name: 'update_goal', arguments: '{"status":"complete"}' }] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else { yield { type: 'text_delta', text: 'An unfinished final' }; yield { type: 'done', finishReason: 'length' }; }
      } },
    });
    await loop.setThreadGoal(thread.id, { objective: 'Write a short answer.', status: 'active' });
    await waitForTestState(() => loop.getThreadGoal(thread.id), value => value?.status === 'blocked', value => JSON.stringify(value));
    const events = await store.listEvents(thread.id);
    expect(events.some(event => event.type === 'turn.completed')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'runtime.error', payload: expect.objectContaining({ message: expect.stringContaining('token limit') }) }));
  });

  it.each(['repair', 'stale', 'blocked'] as const)('handles %s without prematurely completing', async mode => {
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await store.createThread({ title: 'Verified Goal' });
    let step = 0;
    let verifications = 0;
    let reads = 0;
    const loop = createGoalEnabledAgentLoop({ ids, threadStore: store, eventBus: new InMemoryEventBus(), clock: systemClock,
      toolHost: { listTools: async () => [{ name: 'read_file', description: 'Read verification output', inputSchema: { type: 'object' } }],
        runTool: async () => ({ content: ++reads === 1 && mode === 'repair' ? 'Behavior check: FAILED' : 'Behavior check: PASSED' }) },
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        if (request.responseFormat?.name === 'goal_completion_verification') {
          verifications++;
          const input = JSON.parse(request.messages[1].content) as { sources: Array<{ id: string; role: string }> };
          const evidence = input.sources.filter(source => source.role === 'tool').at(-1)!;
          const passed = mode !== 'blocked' && (mode !== 'repair' || verifications > 1);
          yield { type: 'text_delta', text: JSON.stringify({ passed,
            checks: [{ requirement: 'Requested behavior works', passed, evidenceIds: [evidence.id], finding: passed ? 'Recorded check passed.' : 'Behavior check failed; repair it.' }],
            gaps: passed ? [] : ['Repair the failed behavior check.'] }) };
          yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } };
          yield { type: 'done', finishReason: 'stop' }; return;
        }
        step++;
        const read = step === 1 || (step === 3 && mode !== 'blocked');
        const complete = step === 2 || (step === 4 && mode !== 'stale') || (step === 3 && mode === 'blocked') || (step === 5 && mode === 'stale');
        if (read || complete) {
          yield { type: 'tool_calls', toolCalls: [{ id: `call_${step}`, name: read ? 'read_file' : 'update_goal', arguments: read ? '{}' : '{"status":"complete"}' }] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else {
          yield { type: 'text_delta', text: 'Task outcome reported.' };
          yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } };
          yield { type: 'done', finishReason: 'stop' };
        }
      } },
    });
    await loop.setThreadGoal(thread.id, { objective: 'Verify the requested behavior.', status: 'active' });
    const expectedStatus = mode === 'blocked' ? 'blocked' : 'complete';
    const expectedTokens = (mode === 'blocked' ? 3 : 2) * 5 + (mode === 'stale' ? 14 : 7);
    const saved = await waitForTestState(() => loop.getThreadGoal(thread.id),
      value => value?.status === expectedStatus && value.tokensUsed === expectedTokens, value => JSON.stringify(value));
    expect(saved?.status).toBe(expectedStatus);
    expect(verifications).toBe(mode === 'blocked' ? 3 : 2);
    expect(saved?.tokensUsed).toBe(expectedTokens);
    await loop.shutdown();
    const events = await store.listEvents(thread.id);
    expect(events.filter(event => event.type === 'feature.event' && event.eventType === 'goal.verification-recorded')).toHaveLength(verifications);
    const exits = events.flatMap(event => event.type === 'message.created' && event.payload.message.goalMode
      ? [event.payload.message] : []);
    expect(exits).toHaveLength(1);
    expect(exits[0].goalMode).toMatchObject({ kind: expectedStatus, goal: { status: expectedStatus, tokensUsed: expectedTokens } });
    if (mode === 'blocked') expect(exits[0].content).toContain('Repair the failed behavior check.');
  });
});
