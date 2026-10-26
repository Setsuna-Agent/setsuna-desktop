import type { ModelRequest, RuntimeMessage, RuntimeThread, StoredThreadEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { reduceGoalState, reduceGoalVerification, goalStateCodec, type Goal, type GoalRuntimeHost } from '../../src/contracts/index.js';
import { verifyGoalCompletion, verificationWasInvalidated } from '../../src/runtime/goal-completion-verification.js';

const goal: Goal = { version: 1, id: 'goal', threadId: 'thread', objective: 'Fix cancellation and verify it.',
  status: 'active', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 };

function setup(verdict: unknown, finishReason = 'stop') {
  const appendEvents = vi.fn(async () => []);
  const generateVerification = vi.fn(async (_request: ModelRequest) => ({ content: JSON.stringify(verdict), finishReason }));
  const host = {
    now: () => new Date('2026-10-26T00:00:00Z'), id: () => 'event', appendEvents, generateVerification,
    listEvents: async () => [],
    getThread: async () => ({ id: 'thread', lastSeq: 10, messages: [{ id: 'evidence', toolCallId: 'check', toolName: 'exec_command',
      role: 'tool', status: 'complete', content: 'Cancellation behavior test: passed.', createdAt: '2026-10-26T00:00:00Z' }] }) as RuntimeThread,
  } as unknown as GoalRuntimeHost;
  const context = { threadId: 'thread', turnId: 'turn', verificationModel: { model: 'test-model' } };
  return { host, context, appendEvents, generateVerification };
}
const passed = { passed: true, checks: [{ requirement: 'Cancellation works', passed: true, evidenceIds: ['evidence'], finding: 'Behavior test passed.' }], gaps: [] };

describe('Goal completion evidence', () => {
  it('evaluates evidence without committing it and preserves valid reports across usage updates only', async () => {
    const fixture = setup(passed);
    const report = await verifyGoalCompletion({ ...fixture, goal });
    expect(report).toMatchObject({ passed: true, observedThroughSeq: 10, attempt: 1 });
    expect(fixture.generateVerification.mock.calls[0][0].tools).toEqual([]);
    expect(fixture.generateVerification.mock.calls[0][0].messages[1].content).toContain(goal.objective);
    expect(fixture.appendEvents).not.toHaveBeenCalled();
    const state = reduceGoalVerification({ goal }, report);
    expect(goalStateCodec.parse(state).verification).toEqual(report);
    expect(reduceGoalState(state, { goal: { ...goal, tokensUsed: 42 } }).verification).toEqual(report);
    expect(reduceGoalState(state, { goal: { ...goal, objective: 'Different objective' } }).verification).toBeUndefined();
  });

  it.each([
    [{ ...passed, checks: [{ ...passed.checks[0], evidenceIds: ['invented'] }] }, 'stop'],
    [passed, 'length'],
    [{ passed: true, checks: [], gaps: [] }, 'stop'],
  ])('rejects unverifiable verdicts %#', async (verdict, finish) => {
    const fixture = setup(verdict, finish as string);
    const report = await verifyGoalCompletion({ ...fixture, goal });
    expect(report.passed).toBe(false);
    expect(report.gaps.length).toBeGreaterThan(0);
  });

  it('invalidates passed evidence after new work and propagates cancellation without recording success', async () => {
    const fixture = setup(passed);
    const report = await verifyGoalCompletion({ ...fixture, goal });
    const event = { seq: 11, type: 'tool.started', payload: { toolName: 'exec_command' } } as StoredThreadEvent;
    expect(verificationWasInvalidated(report, [event])).toBe(true);
    expect(verificationWasInvalidated(report, [{ ...event, seq: 9 }])).toBe(false);
    const signal = AbortSignal.abort(new Error('cancelled'));
    fixture.appendEvents.mockClear();
    await expect(verifyGoalCompletion({ ...fixture, goal, context: { ...fixture.context, signal } })).rejects.toThrow('cancelled');
    expect(fixture.appendEvents).not.toHaveBeenCalled();
  });

  it.each(['turn_a', 'turn_b'])('pairs reused call IDs by transaction when the later result belongs to %s', async laterTurnId => {
    const fixture = setup(passed);
    const createdAt = '2026-10-26T00:00:00Z';
    const first: RuntimeMessage = { id: 'evidence', turnId: 'turn_a', role: 'tool', status: 'complete',
      toolCallId: 'call_0', toolName: 'exec_command', content: 'PASS', createdAt };
    const second: RuntimeMessage = { ...first, id: 'evidence_b', turnId: laterTurnId, content: 'FAIL', status: 'error' };
    const orphan = { ...second, id: 'orphan', content: 'No matching execution' };
    const common = { threadId: 'thread', createdAt };
    const events: StoredThreadEvent[] = [
      { ...common, id: 'start_a', seq: 1, turnId: first.turnId, type: 'tool.started',
        payload: { toolCallId: 'call_0', toolName: 'exec_command', argumentsPreview: 'test A before hook' } },
      { ...common, id: 'complete_a', seq: 2, turnId: first.turnId, type: 'tool.completed',
        payload: { toolCallId: 'call_0', toolName: 'exec_command', status: 'success', content: 'PASS', argumentsPreview: 'test A after hook' } },
      { ...common, id: 'result_a', seq: 3, turnId: first.turnId, type: 'message.created', payload: { message: first } },
      { ...common, id: 'start_b', seq: 4, turnId: laterTurnId, type: 'tool.started',
        payload: { toolCallId: 'call_0', toolName: 'exec_command', argumentsPreview: 'test B' } },
      { ...common, id: 'complete_b', seq: 5, turnId: laterTurnId, type: 'tool.completed',
        payload: { toolCallId: 'call_0', toolName: 'exec_command', status: 'error', content: 'FAIL' } },
      { ...common, id: 'result_b', seq: 6, turnId: laterTurnId, type: 'message.created', payload: { message: second } },
      { ...common, id: 'orphan', seq: 7, turnId: laterTurnId, type: 'message.created', payload: { message: orphan } },
      { ...common, id: 'later', seq: 8, turnId: laterTurnId, type: 'tool.started',
        payload: { toolCallId: 'call_0', toolName: 'exec_command', argumentsPreview: 'test C outside the evidence snapshot' } },
    ];
    fixture.host.listEvents = async () => events;
    fixture.host.getThread = async () => ({ id: 'thread', lastSeq: 7,
      // Compaction may persist a model-wire ID; message identity still anchors the execution.
      messages: [first, { ...second, toolCallId: 'wire_rewritten_0' }, orphan],
    }) as RuntimeThread;
    await verifyGoalCompletion({ ...fixture, goal });
    const input = JSON.parse(fixture.generateVerification.mock.calls[0][0].messages[1].content) as {
      sources: Array<{ id: string; arguments?: string; content: string }>;
    };
    expect(input.sources).toMatchObject([
      { id: 'evidence', arguments: 'test A after hook', content: 'PASS' },
      { id: 'evidence_b', arguments: 'test B', content: 'FAIL' },
      { id: 'orphan', content: 'No matching execution' },
    ]);
    expect(input.sources[2].arguments).toBeUndefined();
  });
});
