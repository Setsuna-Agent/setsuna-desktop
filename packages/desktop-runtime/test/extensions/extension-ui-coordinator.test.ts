import { describe, expect, it, vi } from 'vitest';
import { ExtensionUiCoordinator } from '../../src/extensions/extension-ui-coordinator.js';
import type { ApprovalGate, CreateApprovalInput } from '../../src/ports/approval-gate.js';

describe('extension UI coordinator', () => {
  it('projects structured input through the audited approval flow during a tool call', async () => {
    const createApproval = vi.fn(async (input: CreateApprovalInput) => ({
      ...input,
      id: 'approval_extension_ui',
      status: 'pending' as const,
      createdAt: '2026-08-09T00:00:00.000Z',
    }));
    const forgetApproval = vi.fn();
    const approvals = {
      createApproval,
      waitForDecision: vi.fn(async () => ({
        decision: 'approve' as const,
        userInputResponse: { action: 'submit' as const, values: { value: 'blue' } },
      })),
      answerApproval: vi.fn(async () => { throw new Error('not expected'); }),
      listApprovals: vi.fn(async () => ({ approvals: [] })),
      forgetApproval,
    } as ApprovalGate;
    const append = vi.fn(async (_threadId: string, _event: { type: string }) => null);
    const coordinator = new ExtensionUiCoordinator(
      approvals,
      { append },
      { now: () => new Date('2026-08-09T00:00:00.000Z') },
      { id: (prefix) => `${prefix}_1` },
    );

    await expect(coordinator.handle(
      'ui.select',
      {
        message: 'Choose a color',
        options: [
          { value: 'blue', label: 'Blue' },
          { value: 'green', label: 'Green' },
        ],
      },
      { threadId: 'thread_1', turnId: 'turn_1', toolCallId: 'call_1' },
      { id: 'demo', name: 'Demo extension' },
    )).resolves.toBe('blue');

    expect(createApproval).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolCallId: 'call_1',
      toolName: 'extension_ui:demo',
      userInput: expect.objectContaining({
        requestedSchema: expect.objectContaining({ type: 'object' }),
      }),
    }));
    expect(append.mock.calls.map(([, event]) => event.type)).toEqual([
      'approval.requested',
      'approval.resolved',
    ]);
    expect(forgetApproval).toHaveBeenCalledWith('approval_extension_ui');
  });

  it('fails fast instead of creating an invisible interactive card outside a tool call', async () => {
    const createApproval = vi.fn();
    const coordinator = new ExtensionUiCoordinator(
      { createApproval } as unknown as ApprovalGate,
      { append: vi.fn(async (_threadId: string, _event: { type: string }) => null) },
      { now: () => new Date('2026-08-09T00:00:00.000Z') },
      { id: (prefix) => `${prefix}_1` },
    );

    await expect(coordinator.handle(
      'ui.confirm',
      { message: 'Continue?' },
      { threadId: 'thread_1', turnId: 'turn_1' },
      { id: 'demo', name: 'Demo extension' },
    )).rejects.toThrow('interactive extension UI is available only while a tool is running');
    expect(createApproval).not.toHaveBeenCalled();
  });
});
