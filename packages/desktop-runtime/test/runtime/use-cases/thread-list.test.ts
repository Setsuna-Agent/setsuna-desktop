import type { RuntimeApprovalRequest, RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { expect, it, vi } from 'vitest';
import type { RuntimeContainer } from '../../../src/runtime/runtime-factory.js';
import { listRuntimeThreadSummaries } from '../../../src/runtime/use-cases/thread-list.js';

const summary = (id: string): RuntimeThreadSummary => ({
  id, title: id, createdAt: '', updatedAt: '', archived: false, messageCount: 0, lastMessagePreview: '',
});
const approval = (threadId: string, fields: Partial<RuntimeApprovalRequest> = {}): RuntimeApprovalRequest => ({
  id: threadId, threadId, turnId: 'turn', toolCallId: 'call', toolName: 'test', reason: '',
  argumentsPreview: '', status: 'pending', createdAt: '', ...fields,
});

it('projects only pending human decisions for the active turn and clears waiting state after resolution', async () => {
  const threads = ['approval', 'input', 'elicitation', 'automatic', 'resolved', 'previous', 'idle'].map(summary);
  let approvals = [
    approval('approval'), approval('input'),
    approval('input', { userInput: { message: 'Choose', requestedSchema: { type: 'object', properties: {} } } }),
    approval('elicitation', { elicitation: { mode: 'url', serverKey: 'mcp', message: 'Sign in', displayUrl: 'https://example.com', elicitationId: 'form' } }),
    approval('automatic', { reviewer: 'automatic' }), approval('resolved', { status: 'approved' }),
    approval('previous', { turnId: 'old-turn' }), approval('idle'),
  ];
  const active = new Set(threads.filter((thread) => thread.id !== 'idle').map((thread) => thread.id));
  const listApprovals = vi.fn(async () => ({ approvals }));
  const listThreads = vi.fn(async () => threads);
  const runtime = {
    threadStore: { listThreads },
    agentLoop: { activeTurnId: (id: string) => active.has(id) ? 'turn' : null },
    approvalGate: { listApprovals },
  } as unknown as RuntimeContainer;
  const states = async () => Object.fromEntries((await listRuntimeThreadSummaries(runtime, {}))
    .map((thread) => [thread.id, thread.activeTurnState]));

  expect(await states()).toEqual({
    approval: 'waiting_for_approval', input: 'waiting_for_input', elicitation: 'waiting_for_input',
    automatic: 'running', resolved: 'running', previous: 'running', idle: null,
  });
  expect(listApprovals).toHaveBeenCalledTimes(1);
  approvals = [];
  expect(await states()).toMatchObject({ approval: 'running', input: 'running' });
  active.clear();
  expect((await listRuntimeThreadSummaries(runtime, {})).every((thread) => thread.activeTurnId === null
    && thread.activeTurnState === null)).toBe(true);
  expect(listApprovals).toHaveBeenCalledTimes(2);
});

it('does not load approvals or conversation history for the idle startup list', async () => {
  const listApprovals = vi.fn(async () => { throw new Error('Unavailable'); });
  const getThread = vi.fn();
  const runtime = {
    threadStore: { listThreads: async () => [summary('idle')], getThread },
    agentLoop: { activeTurnId: () => null }, approvalGate: { listApprovals },
  } as unknown as RuntimeContainer;
  await expect(listRuntimeThreadSummaries(runtime, {})).resolves.toMatchObject([{ id: 'idle', activeTurnId: null }]);
  expect(listApprovals).not.toHaveBeenCalled();
  expect(getThread).not.toHaveBeenCalled();
});
