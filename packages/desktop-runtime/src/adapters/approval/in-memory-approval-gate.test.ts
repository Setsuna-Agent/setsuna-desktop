import { describe, expect, it } from 'vitest';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import { InMemoryApprovalGate } from './in-memory-approval-gate.js';

describe('InMemoryApprovalGate', () => {
  it('bounds resolved approval history while retaining pending approvals', async () => {
    let sequence = 0;
    const ids: IdGenerator = { id: (prefix) => `${prefix}_${++sequence}` };
    const clock: Clock = { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)) };
    const gate = new InMemoryApprovalGate(clock, ids);

    for (let index = 0; index < 105; index += 1) {
      const approval = await gate.createApproval({
        threadId: 'thread_1',
        turnId: `turn_${index}`,
        toolCallId: `call_${index}`,
        toolName: 'exec_command',
        reason: 'Test approval',
        argumentsPreview: '{}',
      });
      await gate.answerApproval(approval.id, { decision: 'approve' });
    }
    const pending = await gate.createApproval({
      threadId: 'thread_1',
      turnId: 'turn_pending',
      toolCallId: 'call_pending',
      toolName: 'exec_command',
      reason: 'Pending approval',
      argumentsPreview: '{}',
    });

    const approvals = await gate.listApprovals();

    expect(approvals.approvals).toHaveLength(101);
    expect(approvals.approvals).toContainEqual(expect.objectContaining({ id: pending.id, status: 'pending' }));
    expect(approvals.approvals.some((approval) => approval.id === 'approval_1')).toBe(false);
  });

  it('validates structured user input decisions and field values', async () => {
    const ids: IdGenerator = { id: (prefix) => `${prefix}_1` };
    const clock: Clock = { now: () => new Date('2026-07-15T00:00:00.000Z') };
    const gate = new InMemoryApprovalGate(clock, ids);
    const approval = await gate.createApproval({
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolCallId: 'call_1',
      toolName: 'request_user_input',
      reason: 'Choose an environment.',
      argumentsPreview: '{}',
      userInput: {
        message: 'Choose an environment.',
        requestedSchema: {
          type: 'object',
          properties: {
            environment: { type: 'string', oneOf: [{ const: 'staging', title: 'Staging' }] },
          },
          required: ['environment'],
        },
      },
    });

    await expect(gate.answerApproval(approval.id, {
      decision: 'approve',
      userInputResponse: { action: 'submit', values: {} },
    })).rejects.toThrow("User input field 'environment' is required");
    await expect(gate.answerApproval(approval.id, {
      decision: 'reject',
      userInputResponse: { action: 'submit', values: { environment: 'staging' } },
    })).rejects.toThrow('does not match the approval decision');
    await expect(gate.answerApproval(approval.id, {
      decision: 'approve',
      userInputResponse: { action: 'submit', values: { environment: 'staging' } },
    })).resolves.toMatchObject({ status: 'approved' });
  });
});
