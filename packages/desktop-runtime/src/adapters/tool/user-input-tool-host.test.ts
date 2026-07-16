import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEventWriter } from '../../loop/runtime-event-writer.js';
import { ToolOrchestrator } from '../../loop/tool-orchestrator.js';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { RuntimeToolExecutionContext } from '../../ports/tool-host.js';
import { InMemoryApprovalGate } from '../approval/in-memory-approval-gate.js';
import { REQUEST_USER_INPUT_TOOL_NAME, UserInputToolHost } from './user-input-tool-host.js';

describe('user input tool host', () => {
  afterEach(() => vi.useRealTimers());

  it('declares explicit string types for enum-constrained tool inputs', async () => {
    const fixture = createFixture();

    await expect(fixture.host.listTools({ threadId: 'thread_1' })).resolves.toEqual([
      expect.objectContaining({
        name: REQUEST_USER_INPUT_TOOL_NAME,
        inputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            fields: expect.objectContaining({
              items: expect.objectContaining({
                properties: expect.objectContaining({
                  type: { type: 'string', enum: ['text', 'textarea', 'number', 'integer', 'boolean', 'select', 'multiselect'] },
                  format: { type: 'string', enum: ['date', 'date-time', 'email', 'uri'] },
                }),
              }),
            }),
          }),
        }),
      }),
    ]);
  });

  it('publishes an audited structured form and returns the submitted values to the model', async () => {
    const fixture = createFixture();
    const running = fixture.host.runTool(REQUEST_USER_INPUT_TOOL_NAME, {
      title: 'Deployment',
      message: 'Choose the target environment.',
      fields: [
        {
          id: 'environment',
          label: 'Environment',
          type: 'select',
          required: true,
          options: [
            { value: 'staging', label: 'Staging', description: 'Safe pre-production target.' },
            { value: 'production', label: 'Production' },
          ],
        },
        { id: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Optional context' },
      ],
    }, executionContext());

    await vi.waitFor(async () => expect((await fixture.approvals.listApprovals()).approvals).toHaveLength(1));
    const approval = (await fixture.approvals.listApprovals()).approvals[0];
    expect(approval).toMatchObject({
      toolName: REQUEST_USER_INPUT_TOOL_NAME,
      userInput: {
        title: 'Deployment',
        requestedSchema: {
          required: ['environment'],
          properties: {
            environment: {
              type: 'string',
              oneOf: expect.arrayContaining([
                { const: 'staging', title: 'Staging', description: 'Safe pre-production target.' },
              ]),
            },
            notes: { type: 'string', multiline: true, placeholder: 'Optional context' },
          },
        },
      },
    });

    await fixture.approvals.answerApproval(approval.id, {
      decision: 'approve',
      userInputResponse: { action: 'submit', values: { environment: 'staging', notes: 'Ship after tests.' } },
    });
    await expect(running).resolves.toMatchObject({
      content: expect.stringContaining('"environment": "staging"'),
      data: { action: 'submit', values: { environment: 'staging', notes: 'Ship after tests.' } },
    });
    expect(fixture.append).toHaveBeenCalledWith('thread_1', expect.objectContaining({
      type: 'approval.requested',
      payload: { approval: expect.objectContaining({ userInput: expect.any(Object) }) },
    }));
    expect(fixture.append).toHaveBeenCalledWith('thread_1', expect.objectContaining({
      type: 'approval.resolved',
      payload: expect.objectContaining({ decision: 'approve' }),
    }));
    await expect(fixture.approvals.listApprovals()).resolves.toEqual({ approvals: [] });
  });

  it('auto-resolves after the bounded timeout using only explicit defaults', async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const running = fixture.host.runTool(REQUEST_USER_INPUT_TOOL_NAME, {
      message: 'This preference is useful but non-blocking.',
      fields: [
        { id: 'theme', label: 'Theme', type: 'select', default: 'system', options: [
          { value: 'system', label: 'System' },
          { value: 'dark', label: 'Dark' },
        ] },
        { id: 'notes', label: 'Notes', type: 'text' },
      ],
      auto_resolution_ms: 60_000,
    }, executionContext());

    await vi.advanceTimersByTimeAsync(0);
    const approval = (await fixture.approvals.listApprovals()).approvals[0];
    expect(approval.userInput).toMatchObject({
      autoResolutionMs: 60_000,
      expiresAt: '2026-07-15T00:01:00.000Z',
    });
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(running).resolves.toMatchObject({
      data: { action: 'timeout', values: { theme: 'system' } },
      preview: '用户输入已超时',
    });
  });

  it('stays available in strict mode without a duplicate generic approval', async () => {
    const fixture = createFixture();
    const context = executionContext();
    const orchestrator = new ToolOrchestrator({
      toolHost: fixture.host,
      approvalGate: fixture.approvals,
      clock: fixture.clock,
      events: {
        publishToolStarted: vi.fn(async () => undefined),
        publishToolCompleted: vi.fn(async () => undefined),
        publishToolOutputDelta: vi.fn(async () => undefined),
        publishHookStarted: vi.fn(async () => undefined),
        publishHookCompleted: vi.fn(async () => undefined),
        publishApprovalRequested: vi.fn(async () => undefined),
        publishApprovalResolved: vi.fn(async () => undefined),
      },
    });

    await expect(orchestrator.canRunWithoutApproval({
      id: 'call_1',
      name: REQUEST_USER_INPUT_TOOL_NAME,
      arguments: '{}',
    }, {}, context, 'strict')).resolves.toBe(true);
    await expect(fixture.host.listTools({ threadId: 'thread_1', features: { default_mode_request_user_input: false } })).resolves.toEqual([]);
  });
});

function createFixture() {
  let sequence = 0;
  const clock: Clock = { now: () => new Date('2026-07-15T00:00:00.000Z') };
  const ids: IdGenerator = { id: (prefix) => `${prefix}_${++sequence}` };
  const approvals = new InMemoryApprovalGate(clock, ids);
  const append = vi.fn(async () => null);
  const events = { append } as unknown as RuntimeEventWriter;
  return { append, approvals, clock, host: new UserInputToolHost(approvals, events, clock, ids) };
}

function executionContext(): RuntimeToolExecutionContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    toolCallId: 'call_1',
    environment: { id: 'local', cwd: '/workspace', workspaceRoot: '/workspace', workspaceRoots: ['/workspace'] },
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: {},
    signal: new AbortController().signal,
  };
}
