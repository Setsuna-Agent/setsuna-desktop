import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  ModelRequest,
  ModelStreamEvent,
  RuntimeConfigState,
  RuntimeExecPolicyAmendment,
  RuntimeEvent,
  RuntimeHookRun,
  RuntimeMessage,
  RuntimeNetworkPolicyAmendment,
  RuntimeThread,
  RuntimeThreadSummary,
  RuntimeToolCall,
  RuntimeToolDefinition,
  RuntimeUsageRecord,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';
import { InMemoryApprovalGate } from '../adapters/approval/in-memory-approval-gate.js';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../adapters/id/random-id-generator.js';
import { FileMemoryStore } from '../adapters/store/file-memory-store.js';
import { JsonThreadStore } from '../adapters/store/json-thread-store.js';
import { MemoryToolHost } from '../adapters/tool/memory-tool-host.js';
import type { ConfigStore, RuntimeProviderConfig } from '../ports/config-store.js';
import type { ModelClient, ModelCompactionRequest } from '../ports/model-client.js';
import type { PolicyAmendmentStore, RuntimePolicyAmendments } from '../ports/policy-amendment-store.js';
import type { PersistentToolApprovalStore } from '../ports/persistent-tool-approval-store.js';
import type { SkillRegistry } from '../ports/skill-registry.js';
import type { McpStore } from '../ports/mcp-store.js';
import { systemClock, type Clock } from '../ports/clock.js';
import type { ThreadStore } from '../ports/thread-store.js';
import { ToolExecutionError, type ToolExecutionContext, type ToolHost, type ToolRuntimeProfile, type ToolTurnCleanupOutcome } from '../ports/tool-host.js';
import type { UsageStore } from '../ports/usage-store.js';
import { createRuntimeToolHookRunner } from '../hooks/runtime-hooks.js';
import { AgentLoop } from './agent-loop.js';

describe('agent loop tools', () => {
  it('executes model tool calls and continues with tool results', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Tool loop', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const usageStore = new CapturingUsageStore();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      usageStore,
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const startedTurnId = events.find((event) => event.type === 'turn.started')?.turnId;

    expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[0].tools?.[0].name).toBe('workspace_read_file');
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('file contents'))).toBe(true);
    expect(events.find((event) => event.type === 'turn.started')?.payload).toMatchObject({ taskKind: 'regular' });
    expect(events.find((event) => event.type === 'turn.completed')?.payload).toMatchObject({ taskKind: 'regular' });
    expect(events.some((event) => event.type === 'tool.started' && event.payload.toolName === 'workspace_read_file')).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed' && event.payload.status === 'success')).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'item.completed',
      payload: {
        item: {
          id: 'call_1',
          kind: 'tool_call',
          status: 'completed',
          toolCall: { id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
        },
      },
    }));
    const completed = events.find((event): event is Extract<RuntimeEvent, { type: 'tool.completed' }> =>
      event.type === 'tool.completed' && event.payload.toolName === 'workspace_read_file');
    expect(completed?.payload.argumentsPreview).toContain('README.md');
    expect(completed?.payload.durationMs).toEqual(expect.any(Number));
    expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(saved?.messages.find((message) => message.role === 'assistant' && message.toolCalls?.length)?.toolRuns).toMatchObject([
      { id: 'call_1', name: 'workspace_read_file', status: 'success', argumentsPreview: expect.stringContaining('README.md'), durationMs: expect.any(Number) },
    ]);
    expect(saved?.messages.find((message) => message.role === 'tool')?.content).toContain('file contents');
    expect(saved?.messages.at(-1)?.content).toContain('I read the file.');
    expect(toolHost.cleanupCalls).toEqual([
      { threadId: thread.id, projectId: 'project_1', turnId: startedTurnId, status: 'completed' },
    ]);
    expect(usageStore.records).toMatchObject([
      {
        threadId: thread.id,
        provider: 'test-provider',
        model: 'test-model',
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
      },
    ]);
  });

  it('captures a fresh sampling step before each model request', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Step snapshot', projectId: 'project_1' });
    const modelClient = new StepSnapshotModelClient();
    const toolHost = new RefreshingToolHost();
    const skillRegistry = stepSnapshotSkillRegistry();
    const mcpStore = stepSnapshotMcpStore();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new StepSnapshotConfigStore(),
      skillRegistry,
      mcpStore,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'use the current tool snapshot', skillIds: ['skill_step'] });

    const events = await threadStore.listEvents(thread.id, 0);
    const saved = await threadStore.getThread(thread.id);
    const snapshotEvents = events.filter((event): event is Extract<RuntimeEvent, { type: 'turn.step_snapshot' }> => event.type === 'turn.step_snapshot');

    expect(toolHost.listCalls).toBe(2);
    expect(snapshotEvents.map((event) => event.payload.snapshot.toolNames)).toEqual([
      ['step_tool_1'],
      ['step_tool_2'],
    ]);
    expect(snapshotEvents.map((event) => event.payload.snapshot.advertisedToolNames)).toEqual([
      ['step_tool_1'],
      ['step_tool_2'],
    ]);
    expect(snapshotEvents.map((event) => event.payload.snapshot.deferredToolNames)).toEqual([[], []]);
    expect(snapshotEvents.map((event) => event.payload.snapshot.routerToolNames)).toEqual([[], []]);
    expect(saved?.turns?.[0]?.stepSnapshots?.map((step) => step.snapshot.toolNames)).toEqual([
      ['step_tool_1'],
      ['step_tool_2'],
    ]);
    expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['step_tool_1']);
    expect(modelClient.requests[1].tools?.map((tool) => tool.name)).toEqual(['step_tool_2']);
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('step_tool_1 result'))).toBe(true);
    const firstSnapshotEnvironment = modelClient.requests[0].stepSnapshot?.toolEnvironment;
    const secondSnapshotEnvironment = modelClient.requests[1].stepSnapshot?.toolEnvironment;
    expect(modelClient.requests[0].stepSnapshot).toMatchObject({
      threadId: thread.id,
      projectId: 'project_1',
      toolNames: ['step_tool_1'],
      advertisedToolNames: ['step_tool_1'],
      deferredToolNames: [],
      routerToolNames: [],
      toolChoice: 'auto',
      toolEnvironment: {
        id: expect.stringMatching(/^step_env_\d+$/),
        cwd: expect.stringMatching(/^\/tmp\/setsuna-step-\d+$/),
      },
      selectedSkills: [{ id: 'skill_step', name: 'Step Skill' }],
      mcpServerKeys: ['alpha', 'zeta'],
      mcpServerCount: 2,
      permissionProfile: 'read-only',
      sandboxWorkspaceWrite: { writableRoots: ['/tmp/setsuna-step-writable'], networkAccess: false },
      contextWindow: {
        autoCompactTokenLimit: expect.any(Number),
        compactionSummaryMessageIds: [],
        estimatedTokens: expect.any(Number),
        maxContextTokens: expect.any(Number),
        maxContextTokensK: expect.any(Number),
        messageCount: expect.any(Number),
        tokensUntilCompaction: expect.any(Number),
      },
      featureKeys: ['request_permissions_tool', 'step_snapshot'],
      worldState: {
        activeProviderId: 'test',
        configPath: '/tmp/config.json',
        dataPath: '/tmp',
        memoryEnabled: false,
        storagePath: '/tmp/memories',
        threadMessageCount: expect.any(Number),
        threadUpdatedAt: expect.any(String),
      },
    });
    expect(modelClient.requests[1].stepSnapshot).toMatchObject({
      toolNames: ['step_tool_2'],
      advertisedToolNames: ['step_tool_2'],
      toolEnvironment: {
        id: expect.stringMatching(/^step_env_\d+$/),
        cwd: expect.stringMatching(/^\/tmp\/setsuna-step-\d+$/),
      },
    });
    expect(modelClient.requests[1].stepSnapshot?.permissionProfile).toBe('workspace-write');
    expect(modelClient.requests[1].stepSnapshot?.sandboxWorkspaceWrite).toMatchObject({
      writableRoots: ['/tmp/setsuna-step-writable-2'],
      networkAccess: true,
    });
    expect(modelClient.requests[1].stepSnapshot?.featureKeys).toEqual([
      'mid_turn_config_refresh',
      'request_permissions_tool',
      'step_snapshot',
    ]);
    expect(modelClient.requests[1].stepSnapshot?.worldState.activeProviderId).toBe('test-updated');
    expect(secondSnapshotEnvironment).not.toEqual(firstSnapshotEnvironment);
    expect(modelClient.requests[0].stepSnapshot?.conversationMessageIds).toHaveLength(1);
    expect(modelClient.requests[1].stepSnapshot?.conversationMessageIds.length).toBeGreaterThan(1);
    expect(modelClient.requests[0].stepSnapshot?.messageIds).toContain('skill_skill_step');
    expect(modelClient.requests[0].stepSnapshot?.threadLastSeq).toEqual(expect.any(Number));
    expect(modelClient.requests[0].stepSnapshot?.contextWindow?.estimatedTokens).toBeGreaterThan(0);
    expect(modelClient.requests[0].stepSnapshot?.contextWindow?.tokensUntilCompaction).toBeGreaterThan(0);
    expect(toolHost.runContexts[0].environment).toEqual(firstSnapshotEnvironment);
  });

  it('keeps plan collaboration mode from executing tools', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Plan-only loop', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'make a plan first', collaborationMode: 'plan' });
    const saved = await threadStore.getThread(thread.id);

    expect(modelClient.requests).toHaveLength(1);
    expect(modelClient.requests[0].tools).toBeUndefined();
    expect(modelClient.requests[0].toolChoice).toBe('none');
    expect(modelClient.requests[0].stepSnapshot?.toolNames).toEqual([]);
    expect(modelClient.requests[0].stepSnapshot?.advertisedToolNames).toEqual([]);
    expect(modelClient.requests[0].stepSnapshot?.routerToolNames).toEqual([]);
    expect(modelClient.requests[0].messages.some((message) => message.id === 'desktop_plan_mode' && message.content.includes('<plan_mode>'))).toBe(true);
    expect(toolHost.calls).toEqual([]);
    expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(saved?.messages.at(-1)?.content).toContain('Plan mode is active');
    expect(saved?.messages.at(-1)?.planMode).toEqual({ mode: 'plan', status: 'awaiting_confirmation' });
  });

  it('persists PlanDelta-only model output as the plan-mode assistant message', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Plan delta loop', projectId: 'project_1' });
    const modelClient = new PlanDeltaOnlyModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'plan from delta stream', collaborationMode: 'plan' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(modelClient.requests[0].tools).toBeUndefined();
    expect(modelClient.requests[0].toolChoice).toBe('none');
    expect(toolHost.calls).toEqual([]);
    expect(events.filter((event) => event.type === 'plan.delta').map((event) => event.payload.delta)).toEqual([
      '1. Inspect current files.\n',
      '2. Wait for confirmation before edits.',
    ]);
    expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(saved?.messages.at(-1)?.content).toBe('1. Inspect current files.\n2. Wait for confirmation before edits.');
    expect(saved?.messages.at(-1)?.planMode).toEqual({ mode: 'plan', status: 'awaiting_confirmation' });
  });

  it('accepts an awaiting Plan mode message when a default turn continues execution', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Plan accept loop', projectId: 'project_1' });
    const modelClient = new PlanThenToolModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'plan before editing', collaborationMode: 'plan' });
    const planned = await threadStore.getThread(thread.id);
    const planMessageId = planned?.messages.at(-1)?.id;

    await loop.sendTurn(thread.id, { input: 'Proceed with the plan.' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const planUpdatedIndex = events.findIndex((event) =>
      event.type === 'message.plan_mode_updated' &&
      event.payload.messageId === planMessageId &&
      event.payload.planMode.status === 'accepted'
    );
    const executionTurnIndex = events.findIndex((event) =>
      event.type === 'turn.started' &&
      event.payload.input === 'Proceed with the plan.'
    );

    expect(saved?.messages.find((message) => message.id === planMessageId)?.planMode).toEqual({ mode: 'plan', status: 'accepted' });
    expect(planUpdatedIndex).toBeGreaterThanOrEqual(0);
    expect(executionTurnIndex).toBeGreaterThan(planUpdatedIndex);
    expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
    expect(modelClient.requests[0].toolChoice).toBe('none');
    expect(modelClient.requests[1].tools?.map((tool) => tool.name)).toContain('workspace_read_file');
  });

  it('runs PreToolUse hooks and blocks denied tool calls', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Hook block', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        PreToolUse: [{
          matcher: 'workspace_read_file',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stderr.write('blocked by policy'); process.exit(2);"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      payload: expect.objectContaining({
        toolName: 'workspace_read_file',
        status: 'rejected',
        content: expect.stringContaining('blocked by policy'),
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.started',
      payload: expect.objectContaining({
        eventName: 'PreToolUse',
        toolName: 'workspace_read_file',
        status: 'running',
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PreToolUse',
        toolName: 'workspace_read_file',
        status: 'blocked',
        message: 'blocked by policy',
        entries: [{ kind: 'feedback', text: 'blocked by policy' }],
      }),
    }));
    const hookRun = saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns?.[0];
    expect(hookRun).toMatchObject({
      eventName: 'PreToolUse',
      status: 'blocked',
      message: 'blocked by policy',
      entries: [{ kind: 'feedback', text: 'blocked by policy' }],
    });
    expect(saved?.messages.find((message) => message.role === 'tool')?.content).toContain('blocked by policy');
  });

  it('treats star hook matchers as match-all like Codex', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Hook star matcher', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        PreToolUse: [{
          matcher: '*',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stderr.write('blocked by star matcher'); process.exit(2);"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PreToolUse',
        matcher: '*',
        status: 'blocked',
        message: 'blocked by star matcher',
      }),
    }));
  });

  it('uses exact matching for literal hook matchers instead of substring regex matching', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Hook literal matcher', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        PreToolUse: [{
          matcher: 'read',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stderr.write('literal read should not match workspace_read_file'); process.exit(2);"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
    expect(events.some((event) => event.type === 'hook.completed')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      payload: expect.objectContaining({
        toolName: 'workspace_read_file',
        status: 'success',
      }),
    }));
  });

  it('runs SessionStart hooks before the first model request and injects context', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Session start hook context', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        SessionStart: [{
          matcher: 'startup',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.hook_event_name !== 'SessionStart' || payload.source !== 'startup') process.exit(1); process.stdout.write('session context from startup'); });"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);
    const firstRequestText = modelClient.requests[0]?.messages.map((message) => message.content).join('\n');

    expect(firstRequestText).toContain('<hook_additional_context>');
    expect(firstRequestText).toContain('session context from startup');
    expect(saved?.messages.find((message) => message.role === 'user')?.hookRuns).toMatchObject([
      {
        eventName: 'SessionStart',
        matcher: 'startup',
        status: 'completed',
        message: 'Added context.',
        entries: [{ kind: 'context', text: 'session context from startup' }],
      },
    ]);
  });

  it('lets SessionStart hooks stop the turn before user prompt hooks and model calls', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Session start hook stop', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        SessionStart: [{
          matcher: 'startup',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ continue: false, stopReason: 'session start paused', hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'saved for later' } }));"),
            timeoutSec: 5,
          }],
        }],
        UserPromptSubmit: [{
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stderr.write('should not run'); process.exit(2);"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);

    expect(modelClient.requests).toEqual([]);
    expect(toolHost.calls).toEqual([]);
    expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(saved?.messages.find((message) => message.role === 'assistant')?.content).toBe('session start paused');
    expect(saved?.messages.find((message) => message.role === 'user')?.hookRuns).toMatchObject([
      {
        eventName: 'SessionStart',
        status: 'stopped',
        message: 'session start paused',
        entries: [
          { kind: 'context', text: 'saved for later' },
          { kind: 'stop', text: 'session start paused' },
        ],
      },
    ]);
  });

  it('runs SessionStart clear hooks after clearing thread context through AgentLoop', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Session start clear hook', projectId: 'project_1' });
    await threadStore.appendEvent(thread.id, {
      id: ids.id('event'),
      threadId: thread.id,
      type: 'message.created',
      createdAt: '2026-06-26T00:03:00.000Z',
      payload: {
        message: {
          id: 'clear_msg_1',
          role: 'user',
          content: 'old context',
          createdAt: '2026-06-26T00:03:00.000Z',
          status: 'complete',
        },
      },
    });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        SessionStart: [{
          matcher: 'clear',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.source !== 'clear') process.exit(1); process.stdout.write('context after clear'); });"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    const cleared = await loop.clearThreadContext(thread.id);
    await loop.sendTurn(thread.id, { input: 'read README after clear' });
    const firstRequestText = modelClient.requests[0]?.messages.map((message) => message.content).join('\n');

    expect(cleared.messages).toEqual([]);
    expect(firstRequestText).toContain('<hook_additional_context>');
    expect(firstRequestText).toContain('context after clear');
    expect(firstRequestText).not.toContain('old context');
  });

  it('runs SubagentStart hooks with agent metadata and ignores continue false', async () => {
    const config = await new HooksConfigStore({
      SubagentStart: [{
        matcher: 'worker',
        hooks: [{
          type: 'command',
          command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.hook_event_name !== 'SubagentStart' || payload.agent_id !== 'agent_child' || payload.agent_type !== 'worker' || payload.permission_mode !== 'on-request') process.exit(1); process.stdout.write(JSON.stringify({ continue: false, stopReason: 'ignored for subagent start', hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: 'child startup context' } })); });"),
          timeoutSec: 5,
        }],
      }],
    }).getConfig();
    const runner = createRuntimeToolHookRunner(config);
    const events = hookEventCapture();

    const outcome = await runner?.runSubagentStart({
      agentId: 'agent_child',
      agentType: 'worker',
      approvalPolicy: 'on-request',
      context: hookContext(),
      environment: hookEnvironment(),
      events,
    });

    expect(outcome).toEqual({ additionalContexts: ['child startup context'] });
    expect(events.completed).toMatchObject([
      {
        eventName: 'SubagentStart',
        status: 'completed',
        message: 'Added context.',
        entries: [{ kind: 'context', text: 'child startup context' }],
      },
    ]);
  });

  it('runs SubagentStop hooks with agent metadata and blocks continuation', async () => {
    const config = await new HooksConfigStore({
      SubagentStop: [{
        matcher: 'worker',
        hooks: [{
          type: 'command',
          command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.hook_event_name !== 'SubagentStop' || payload.agent_id !== 'agent_child' || payload.agent_type !== 'worker' || payload.agent_transcript_path !== '/tmp/agent.jsonl' || payload.last_assistant_message !== 'done') process.exit(1); process.stdout.write(JSON.stringify({ decision: 'block', reason: 'send summary to parent first' })); });"),
          timeoutSec: 5,
        }],
      }],
    }).getConfig();
    const runner = createRuntimeToolHookRunner(config);
    const events = hookEventCapture();

    const outcome = await runner?.runSubagentStop({
      agentId: 'agent_child',
      agentTranscriptPath: '/tmp/agent.jsonl',
      agentType: 'worker',
      approvalPolicy: 'on-request',
      context: hookContext(),
      environment: hookEnvironment(),
      events,
      lastAssistantMessage: 'done',
      stopHookActive: false,
    });

    expect(outcome).toEqual({
      blockReason: 'send summary to parent first',
      shouldBlock: true,
      shouldStop: false,
    });
    expect(events.completed).toMatchObject([
      {
        eventName: 'SubagentStop',
        status: 'blocked',
        message: 'send summary to parent first',
        entries: [{ kind: 'feedback', text: 'send summary to parent first' }],
      },
    ]);
  });

  it('runs UserPromptSubmit hooks and stops the turn before model calls', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'User prompt hook block', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        UserPromptSubmit: [{
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stderr.write('prompt blocked by hook'); process.exit(2);"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(modelClient.requests).toEqual([]);
    expect(toolHost.calls).toEqual([]);
    expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(saved?.messages.find((message) => message.role === 'assistant')?.content).toBe('prompt blocked by hook');
    expect(saved?.messages.find((message) => message.role === 'user')?.hookRuns).toMatchObject([
      {
        eventName: 'UserPromptSubmit',
        status: 'blocked',
        message: 'prompt blocked by hook',
        entries: [{ kind: 'feedback', text: 'prompt blocked by hook' }],
      },
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.completed',
      payload: expect.objectContaining({ taskKind: 'regular' }),
    }));
  });

  it('injects UserPromptSubmit additional context into the next model request', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'User prompt hook context', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        UserPromptSubmit: [{
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ systemMessage: 'hook warning', hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'prefer compact answers' } }));"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);
    const firstRequestText = modelClient.requests[0]?.messages.map((message) => message.content).join('\n');

    expect(firstRequestText).toContain('<hook_additional_context>');
    expect(firstRequestText).toContain('prefer compact answers');
    expect(saved?.messages.find((message) => message.role === 'user')?.hookRuns).toMatchObject([
      {
        eventName: 'UserPromptSubmit',
        status: 'completed',
        message: 'Added context.',
        entries: [
          { kind: 'warning', text: 'hook warning' },
          { kind: 'context', text: 'prefer compact answers' },
        ],
      },
    ]);
  });

  it('runs Stop hooks and continues the turn when they block stopping', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Stop hook continuation', projectId: 'project_1' });
    const modelClient = new StopHookModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new HooksConfigStore({
        Stop: [{
          hooks: [{
            type: 'command',
            command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (!payload.stop_hook_active) { process.stderr.write('continue with test coverage'); process.exit(2); } process.exit(0); });"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'finish the task' });
    const saved = await threadStore.getThread(thread.id);
    const userMessage = saved?.messages.find((message) => message.role === 'user');
    const assistantMessages = saved?.messages.filter((message) => message.role === 'assistant') ?? [];
    const secondRequestText = modelClient.requests[1]?.messages.map((message) => message.content).join('\n');

    expect(modelClient.requests).toHaveLength(2);
    expect(secondRequestText).toContain('<hook_stop_continuation>');
    expect(secondRequestText).toContain('continue with test coverage');
    expect(assistantMessages.map((message) => message.content)).toEqual(['first answer', 'final answer']);
    expect(userMessage?.hookRuns).toMatchObject([
      {
        eventName: 'Stop',
        status: 'blocked',
        message: 'continue with test coverage',
        entries: [{ kind: 'feedback', text: 'continue with test coverage' }],
      },
      {
        eventName: 'Stop',
        status: 'completed',
      },
    ]);
  });

  it('allows PreToolUse hooks to rewrite tool input before execution', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Hook rewrite', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        PreToolUse: [{
          matcher: 'workspace_read_file',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { path: 'REWRITTEN.md' } } }));"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'REWRITTEN.md' }, projectId: 'project_1' }]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      payload: expect.objectContaining({
        toolName: 'workspace_read_file',
        argumentsPreview: expect.stringContaining('REWRITTEN.md'),
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PreToolUse',
        toolName: 'workspace_read_file',
        status: 'completed',
        message: 'Updated tool input.',
      }),
    }));
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns).toMatchObject([
      { eventName: 'PreToolUse', status: 'completed', message: 'Updated tool input.' },
    ]);
  });

  it('normalizes shell PreToolUse payload as Bash and preserves local args when rewriting', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Bash hook rewrite', projectId: 'project_1' });
    const modelClient = new SingleToolCallModelClient({
      id: 'call_shell_hook',
      name: 'run_shell_command',
      arguments: '{"command":"printf original","risk_level":"low","directory":"scripts"}',
    });
    const toolHost = new CapturingToolHost([RUN_SHELL_COMMAND_TOOL]);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.tool_name !== 'Bash' || payload.tool_input?.command !== 'printf original' || payload.tool_use_id !== 'call_shell_hook') { process.stderr.write(JSON.stringify(payload)); process.exit(1); } process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command: 'printf rewritten' } } })); });"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'run shell' });
    const saved = await threadStore.getThread(thread.id);

    expect(toolHost.calls).toEqual([{
      name: 'run_shell_command',
      input: { command: 'printf rewritten', risk_level: 'low', directory: 'scripts' },
      projectId: 'project_1',
    }]);
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'run_shell_command')?.hookRuns).toMatchObject([
      { eventName: 'PreToolUse', matcher: 'Bash', status: 'completed', message: 'Updated tool input.' },
    ]);
  });

  it('normalizes apply_patch hook payload to Codex command shape and rewrites patch only', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Apply patch hook rewrite', projectId: 'project_1' });
    const originalPatch = '*** Begin Patch\n*** Add File: old.txt\n+old\n*** End Patch';
    const rewrittenPatch = '*** Begin Patch\n*** Add File: new.txt\n+new\n*** End Patch';
    const hookCommand = nodeEvalHook(`const originalPatch = ${JSON.stringify(originalPatch)}; const rewrittenPatch = ${JSON.stringify(rewrittenPatch)}; let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.tool_name !== 'apply_patch' || payload.tool_input?.command !== originalPatch || payload.tool_use_id !== 'call_patch_hook') { process.stderr.write(JSON.stringify(payload)); process.exit(1); } process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command: rewrittenPatch } } })); });`);
    const modelClient = new SingleToolCallModelClient({
      id: 'call_patch_hook',
      name: 'apply_patch',
      arguments: JSON.stringify({ patch: originalPatch, workdir: 'src' }),
    });
    const toolHost = new CapturingToolHost([APPLY_PATCH_TOOL]);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        PreToolUse: [{
          matcher: 'apply_patch',
          hooks: [{
            type: 'command',
            command: hookCommand,
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'apply patch' });
    const saved = await threadStore.getThread(thread.id);

    expect(toolHost.calls).toEqual([{
      name: 'apply_patch',
      input: { patch: rewrittenPatch, workdir: 'src' },
      projectId: 'project_1',
    }]);
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'apply_patch')?.hookRuns).toMatchObject([
      { eventName: 'PreToolUse', matcher: 'apply_patch', status: 'completed', message: 'Updated tool input.' },
    ]);
  });

  it('marks invalid PreToolUse hook output as failed and ignores rewrites', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Hook invalid rewrite', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        PreToolUse: [{
          matcher: 'workspace_read_file',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { path: 'INVALID.md' } } }));"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PreToolUse',
        toolName: 'workspace_read_file',
        status: 'failed',
        message: 'PreToolUse hook returned updatedInput without permissionDecision:allow',
        entries: [{ kind: 'error', text: 'PreToolUse hook returned updatedInput without permissionDecision:allow' }],
      }),
    }));
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns).toMatchObject([
      { eventName: 'PreToolUse', status: 'failed', message: 'PreToolUse hook returned updatedInput without permissionDecision:allow', entries: [{ kind: 'error', text: 'PreToolUse hook returned updatedInput without permissionDecision:allow' }] },
    ]);
  });

  it('runs PostToolUse hooks and returns feedback to the model', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Hook post feedback', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        PostToolUse: [{
          matcher: 'workspace_read_file',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ decision: 'block', reason: 'review the tool result first' }));"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);
    const toolMessage = modelClient.requests[1].messages.find((message) => message.role === 'tool');
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toHaveLength(1);
    expect(toolMessage?.content).toContain('review the tool result first');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      payload: expect.objectContaining({
        toolName: 'workspace_read_file',
        status: 'success',
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PostToolUse',
        toolName: 'workspace_read_file',
        status: 'blocked',
        message: 'review the tool result first',
        entries: [{ kind: 'feedback', text: 'review the tool result first' }],
      }),
    }));
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns).toMatchObject([
      { eventName: 'PostToolUse', status: 'blocked', message: 'review the tool result first', entries: [{ kind: 'feedback', text: 'review the tool result first' }] },
    ]);
  });

  it('marks PostToolUse continue false hooks as stopped and returns feedback', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Hook post stop', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new HooksConfigStore({
        PostToolUse: [{
          matcher: 'workspace_read_file',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ continue: false, stopReason: 'stop after tool', reason: 'model-facing stop feedback' }));"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);
    const toolMessage = modelClient.requests[1].messages.find((message) => message.role === 'tool');
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toHaveLength(1);
    expect(toolMessage?.content).toContain('model-facing stop feedback');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PostToolUse',
        toolName: 'workspace_read_file',
        status: 'stopped',
        message: 'model-facing stop feedback',
        entries: [{ kind: 'stop', text: 'model-facing stop feedback' }],
      }),
    }));
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'workspace_read_file')?.hookRuns).toMatchObject([
      { eventName: 'PostToolUse', status: 'stopped', message: 'model-facing stop feedback', entries: [{ kind: 'stop', text: 'model-facing stop feedback' }] },
    ]);
  });

  it('publishes tool output deltas before completing command tools', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Output delta loop' });
    const loop = new AgentLoop({
      threadStore,
      modelClient: new ShellOutputDeltaModelClient(),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: new OutputDeltaToolHost(),
    });

    await loop.sendTurn(thread.id, { input: 'run command' });
    const events = await threadStore.listEvents(thread.id, 0);
    const deltaIndex = events.findIndex((event) => event.type === 'tool.output_delta');
    const completedIndex = events.findIndex((event) => event.type === 'tool.completed' && event.payload.toolName === 'run_shell_command');

    expect(deltaIndex).toBeGreaterThanOrEqual(0);
    expect(completedIndex).toBeGreaterThan(deltaIndex);
    expect(events[deltaIndex]).toMatchObject({
      type: 'tool.output_delta',
      payload: {
        toolCallId: 'call_shell',
        toolName: 'run_shell_command',
        stream: 'stdout',
        processId: 'shell_test',
        delta: 'streamed output\n',
      },
    });
  });

  it('runs consecutive read-only local tool calls in parallel', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Parallel tools', projectId: 'project_1' });
    const modelClient = new ParallelReadModelClient();
    const toolHost = new ParallelReadToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new SandboxWorkspaceWriteConfigStore(),
    });

    const turn = loop.sendTurn(thread.id, { input: 'inspect both' });
    let waitError: unknown;
    try {
      await waitForToolStarts(toolHost, 2);
    } catch (error) {
      waitError = error;
    } finally {
      toolHost.releaseAll();
    }
    await turn;
    if (waitError) throw waitError;

    const saved = await threadStore.getThread(thread.id);
    expect(toolHost.started).toEqual(['read_file', 'search_text']);
    expect(toolHost.contexts.every((context) => context.permissionProfile === 'workspace-write')).toBe(true);
    expect(toolHost.contexts.every((context) => context.sandboxWorkspaceWrite?.writableRoots?.includes('/tmp/setsuna-extra-writable'))).toBe(true);
    expect(modelClient.requests).toHaveLength(2);
    expect(saved?.messages.filter((message) => message.role === 'tool').map((message) => message.toolName)).toEqual(['read_file', 'search_text']);
    expect(saved?.messages.at(-1)?.content).toContain('parallel results received');
  });

  it('honors tool runtime profile when deciding parallel execution', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Serial profiled tools', projectId: 'project_1' });
    const modelClient = new ParallelReadModelClient();
    const toolHost = new SerialProfileReadToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new SandboxWorkspaceWriteConfigStore(),
    });

    const turn = loop.sendTurn(thread.id, { input: 'inspect both serially' });
    await waitForToolStarts(toolHost, 1);
    expect(toolHost.started).toEqual(['read_file']);
    toolHost.releaseAll();
    await turn;

    const saved = await threadStore.getThread(thread.id);
    expect(toolHost.started).toEqual(['read_file', 'search_text']);
    expect(modelClient.requests).toHaveLength(2);
    expect(saved?.messages.filter((message) => message.role === 'tool').map((message) => message.toolName)).toEqual(['read_file', 'search_text']);
  });

  it('reveals deferred tools through tool_search on the next sampling step', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Deferred tools', projectId: 'project_1' });
    const modelClient = new DeferredToolSearchModelClient();
    const toolHost = new DeferredToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'find the deferred lookup tool' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const toolSearchCompleted = events.find((event): event is Extract<RuntimeEvent, { type: 'tool.completed' }> =>
      event.type === 'tool.completed' && event.payload.toolName === 'tool_search');

    expect(modelClient.requests).toHaveLength(3);
    expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['direct_tool', 'tool_search']);
    expect(modelClient.requests[0].stepSnapshot?.toolNames).toEqual(['direct_tool', 'tool_search']);
    expect(modelClient.requests[0].stepSnapshot?.advertisedToolNames).toEqual(['direct_tool', 'tool_search']);
    expect(modelClient.requests[0].stepSnapshot?.deferredToolNames).toEqual(['deferred_lookup']);
    expect(modelClient.requests[0].stepSnapshot?.routerToolNames).toEqual(['tool_search']);
    expect(modelClient.requests[0].stepSnapshot?.toolRuntimes).toEqual([
      {
        name: 'direct_tool',
        source: 'host',
        exposure: 'direct',
        supportsParallel: false,
        waitsForRuntimeCancellation: true,
      },
      {
        name: 'tool_search',
        source: 'router',
        exposure: 'direct',
        supportsParallel: false,
        waitsForRuntimeCancellation: true,
      },
    ]);
    expect(modelClient.requests[1].tools?.map((tool) => tool.name)).toEqual(['direct_tool', 'deferred_lookup']);
    expect(modelClient.requests[1].stepSnapshot?.toolNames).toEqual(['direct_tool', 'deferred_lookup']);
    expect(modelClient.requests[1].stepSnapshot?.advertisedToolNames).toEqual(['direct_tool', 'deferred_lookup']);
    expect(modelClient.requests[1].stepSnapshot?.deferredToolNames).toEqual([]);
    expect(modelClient.requests[1].stepSnapshot?.routerToolNames).toEqual([]);
    expect(modelClient.requests[1].stepSnapshot?.toolRuntimes).toEqual([
      {
        name: 'direct_tool',
        source: 'host',
        exposure: 'direct',
        supportsParallel: false,
        waitsForRuntimeCancellation: true,
      },
      {
        name: 'deferred_lookup',
        source: 'host',
        exposure: 'deferred',
        supportsParallel: false,
        waitsForRuntimeCancellation: true,
      },
    ]);
    expect(modelClient.requests[1].messages.some((message) =>
      message.role === 'tool'
      && message.toolName === 'tool_search'
      && message.content.includes('deferred_lookup'))).toBe(true);
    expect(toolHost.calls).toEqual([{ name: 'deferred_lookup', input: { id: 'alpha' }, projectId: 'project_1' }]);
    expect(events.some((event) => event.type === 'tool.started' && event.payload.toolName === 'tool_search')).toBe(true);
    expect(toolSearchCompleted?.payload.resultPreview).toContain('Revealed 1 deferred tool');
    expect(toolSearchCompleted?.payload.data).toMatchObject({ revealedToolNames: ['deferred_lookup'] });
    expect(saved?.messages.filter((message) => message.role === 'tool').map((message) => message.toolName)).toEqual(['tool_search', 'deferred_lookup']);
    expect(saved?.messages.at(-1)?.content).toContain('deferred lookup complete');
  });

  it('suggests deferred tools without revealing them before tool_search', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Suggested deferred tools', projectId: 'project_1' });
    const modelClient = new ToolSuggestThenSearchModelClient();
    const toolHost = new DeferredToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new ToolSuggestConfigStore(),
    });

    await loop.sendTurn(thread.id, { input: 'suggest then reveal lookup tool' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const toolSuggestCompleted = events.find((event): event is Extract<RuntimeEvent, { type: 'tool.completed' }> =>
      event.type === 'tool.completed' && event.payload.toolName === 'tool_suggest');
    const toolSearchCompleted = events.find((event): event is Extract<RuntimeEvent, { type: 'tool.completed' }> =>
      event.type === 'tool.completed' && event.payload.toolName === 'tool_search');

    expect(modelClient.requests).toHaveLength(4);
    expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['direct_tool', 'tool_search', 'tool_suggest']);
    expect(modelClient.requests[1].tools?.map((tool) => tool.name)).toEqual(['direct_tool', 'tool_search', 'tool_suggest']);
    expect(modelClient.requests[2].tools?.map((tool) => tool.name)).toEqual(['direct_tool', 'deferred_lookup']);
    expect(modelClient.requests[0].stepSnapshot?.advertisedToolNames).toEqual(['direct_tool', 'tool_search', 'tool_suggest']);
    expect(modelClient.requests[0].stepSnapshot?.deferredToolNames).toEqual(['deferred_lookup']);
    expect(modelClient.requests[0].stepSnapshot?.routerToolNames).toEqual(['tool_search', 'tool_suggest']);
    expect(modelClient.requests[1].stepSnapshot?.advertisedToolNames).toEqual(['direct_tool', 'tool_search', 'tool_suggest']);
    expect(modelClient.requests[1].stepSnapshot?.deferredToolNames).toEqual(['deferred_lookup']);
    expect(modelClient.requests[1].stepSnapshot?.routerToolNames).toEqual(['tool_search', 'tool_suggest']);
    expect(modelClient.requests[2].stepSnapshot?.advertisedToolNames).toEqual(['direct_tool', 'deferred_lookup']);
    expect(modelClient.requests[2].stepSnapshot?.deferredToolNames).toEqual([]);
    expect(modelClient.requests[2].stepSnapshot?.routerToolNames).toEqual([]);
    expect(toolSuggestCompleted?.payload.resultPreview).toContain('Suggested 1 deferred tool');
    expect(toolSuggestCompleted?.payload.data).toMatchObject({
      suggestions: [{ name: 'deferred_lookup', revealWith: 'tool_search' }],
    });
    expect(toolSuggestCompleted?.payload.data).not.toMatchObject({ revealedToolNames: expect.any(Array) });
    expect(toolSearchCompleted?.payload.data).toMatchObject({ revealedToolNames: ['deferred_lookup'] });
    expect(toolHost.calls).toEqual([{ name: 'deferred_lookup', input: { id: 'alpha' }, projectId: 'project_1' }]);
    expect(saved?.messages.filter((message) => message.role === 'tool').map((message) => message.toolName)).toEqual(['tool_suggest', 'tool_search', 'deferred_lookup']);
    expect(saved?.messages.at(-1)?.content).toContain('suggested deferred lookup complete');
  });

  it('keeps router-owned tool_search from being shadowed by host tools', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Reserved tool search', projectId: 'project_1' });
    const modelClient = new DeferredToolSearchModelClient();
    const toolHost = new ToolSearchCollisionHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'discover lookup tool' });

    expect(modelClient.requests[0].tools?.find((tool) => tool.name === 'tool_search')?.description).toContain('Search deferred tools');
    expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['direct_tool', 'tool_search']);
    expect(toolHost.calls).toEqual([{ name: 'deferred_lookup', input: { id: 'alpha' }, projectId: 'project_1' }]);
  });

  it('rejects tool calls that were not advertised in the current sampling step', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Unadvertised deferred tool', projectId: 'project_1' });
    const modelClient = new UnadvertisedDeferredToolModelClient();
    const toolHost = new DeferredToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'call hidden lookup directly' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['direct_tool', 'tool_search']);
    expect(modelClient.requests[0].stepSnapshot?.toolNames).toEqual(['direct_tool', 'tool_search']);
    expect(modelClient.requests[0].stepSnapshot?.advertisedToolNames).toEqual(['direct_tool', 'tool_search']);
    expect(modelClient.requests[0].stepSnapshot?.deferredToolNames).toEqual(['deferred_lookup']);
    expect(modelClient.requests[0].stepSnapshot?.routerToolNames).toEqual(['tool_search']);
    expect(toolHost.calls).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      payload: expect.objectContaining({
        toolName: 'deferred_lookup',
        status: 'error',
        content: expect.stringContaining('not advertised'),
      }),
    }));
    expect(saved?.messages.find((message) => message.role === 'tool' && message.toolName === 'deferred_lookup')?.content).toContain('not advertised');
    expect(saved?.messages.at(-1)?.content).toContain('handled unadvertised tool rejection');
  });

  it('rejects deferred AppServer dynamic tool calls before discovery', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Unadvertised dynamic tool', projectId: 'project_1' });
    const modelClient = new SingleToolCallModelClient({
      id: 'call_unadvertised_dynamic_lookup',
      name: 'tickets__lookup_ticket',
      arguments: '{"id":"ABC-123"}',
    });
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });
    loop.registerAppServerDynamicTools(thread.id, [{
      name: 'tickets__lookup_ticket',
      namespace: 'tickets',
      toolName: 'lookup_ticket',
      deferLoading: true,
      description: 'Look up a ticket by id.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    }], 'dynamic-connection-1');

    await loop.sendTurn(thread.id, { input: 'call hidden dynamic lookup directly' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['workspace_read_file', 'tool_search']);
    expect(modelClient.requests[0].stepSnapshot?.toolNames).toEqual(['workspace_read_file', 'tool_search']);
    expect(modelClient.requests[0].stepSnapshot?.advertisedToolNames).toEqual(['workspace_read_file', 'tool_search']);
    expect(modelClient.requests[0].stepSnapshot?.deferredToolNames).toEqual(['tickets__lookup_ticket']);
    expect(modelClient.requests[0].stepSnapshot?.routerToolNames).toEqual(['tool_search']);
    expect(toolHost.calls).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      payload: expect.objectContaining({
        toolName: 'tickets__lookup_ticket',
        status: 'error',
        content: expect.stringContaining('not advertised'),
      }),
    }));
    expect(saved?.messages.find((message) => message.role === 'tool' && message.toolName === 'tickets__lookup_ticket')?.content).toContain('not advertised');
    expect(saved?.messages.at(-1)?.content).toContain('tool handled');
  });

  it('prioritizes exact deferred tool names in tool_search results', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Exact deferred search', projectId: 'project_1' });
    const modelClient = new ExactDeferredToolSearchModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: new ManyDeferredToolHost(),
    });

    await loop.sendTurn(thread.id, { input: 'load search_graph only' });
    const events = await threadStore.listEvents(thread.id, 0);
    const toolSearchCompleted = events.find((event): event is Extract<RuntimeEvent, { type: 'tool.completed' }> =>
      event.type === 'tool.completed' && event.payload.toolName === 'tool_search');

    expect(toolSearchCompleted?.payload.data).toMatchObject({ revealedToolNames: ['search_graph'] });
    expect(modelClient.requests[1].tools?.map((tool) => tool.name)).toEqual(['direct_tool', 'search_graph', 'tool_search']);
    expect(modelClient.requests[1].stepSnapshot?.advertisedToolNames).toEqual(['direct_tool', 'search_graph', 'tool_search']);
    expect(modelClient.requests[1].stepSnapshot?.deferredToolNames).toEqual(['graph_search_history', 'search_projects']);
    expect(modelClient.requests[1].stepSnapshot?.routerToolNames).toEqual(['tool_search']);
    expect(modelClient.requests[1].tools?.some((tool) => tool.name === 'graph_search_history')).toBe(false);
    expect(modelClient.requests[1].messages.some((message) =>
      message.role === 'tool'
      && message.toolName === 'tool_search'
      && message.content.includes('"search_graph"'))).toBe(true);
  });

  it('pauses overlarge local inspection batches after a visible progress note', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Inspection batch', projectId: 'project_1' });
    const modelClient = new OverlargeInspectionModelClient();
    const toolHost = new CountingReadToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'inspect the project' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const assistantWithTools = saved?.messages.find((message) => message.role === 'assistant' && message.toolCalls?.length);
    const secondRequestToolMessages = modelClient.requests[1].messages.filter((message) => message.role === 'tool');

    expect(toolHost.calls).toHaveLength(8);
    expect(toolHost.calls.map((input) => input.file_path)).toEqual([
      'src/file-1.ts',
      'src/file-2.ts',
      'src/file-3.ts',
      'src/file-4.ts',
      'src/file-5.ts',
      'src/file-6.ts',
      'src/file-7.ts',
      'src/file-8.ts',
    ]);
    expect(modelClient.requests).toHaveLength(2);
    expect(assistantWithTools?.content).toContain('第一批关键文件');
    expect(assistantWithTools?.toolCalls).toHaveLength(10);
    expect(assistantWithTools?.toolRuns).toHaveLength(8);
    expect(secondRequestToolMessages).toHaveLength(10);
    expect(secondRequestToolMessages.slice(8).map((message) => message.toolCallId)).toEqual(['call_9', 'call_10']);
    expect(secondRequestToolMessages.slice(8).every((message) => message.content.includes('was not executed'))).toBe(true);
    expect(events.filter((event) => event.type === 'tool.started')).toHaveLength(8);
    expect(events.filter((event) => event.type === 'tool.completed')).toHaveLength(8);
    expect(saved?.messages.at(-1)?.content).toContain('summarized after first batch');
  });

  it('honors a tool host forced tool choice for the next model request', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Forced tool choice', projectId: 'project_1' });
    const modelClient = new ForcedToolChoiceModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: new ForcedToolChoiceHost(),
    });

    await loop.sendTurn(thread.id, { input: 'continue file change' });

    expect(modelClient.requests[0].toolChoice).toEqual({ type: 'tool', name: 'write_file' });
    expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['write_file']);
  });

  it('publishes streaming tool-call previews from tool argument deltas', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Tool delta loop', projectId: 'project_1' });
    const modelClient = new ToolDeltaModelClient();
    const toolHost = new PreviewingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'write a file' });
    const events = await threadStore.listEvents(thread.id, 0);
    const saved = await threadStore.getThread(thread.id);
    const runningPreview = events.find((event) =>
      event.type === 'tool.started'
      && event.payload.toolName === 'write_file'
      && event.payload.resultPreview?.includes('src/generated.txt')
    );

    expect(runningPreview).toBeTruthy();
    expect(toolHost.partialPreviewCalls).toHaveLength(2);
    expect(toolHost.partialPreviewCalls).toEqual(toolHost.partialPreviewCalls.map(() => ({ name: 'write_file', hasProjectId: true })));
    expect(modelClient.requests[0].messages.map((message) => message.content).join('\n')).toContain('PC local tool prompt');
    expect(saved?.messages.find((message) => message.role === 'assistant' && message.toolRuns?.length)?.toolRuns).toMatchObject([
      {
        id: 'call_delta',
        name: 'write_file',
        status: 'success',
        resultPreview: expect.stringContaining('src/generated.txt'),
      },
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.diff',
      payload: { unifiedDiff: expect.stringContaining('diff --git a/src/generated.txt b/src/generated.txt') },
    }));
    expect(saved?.turns?.[0]?.diff).toContain('+generated');
  });

  it('does not publish streaming previews for deferred tools before discovery', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Deferred delta preview', projectId: 'project_1' });
    const modelClient = new UnadvertisedDeferredToolDeltaModelClient();
    const toolHost = new DeferredPreviewingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'stream hidden lookup arguments' });
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.partialPreviewCalls).toEqual([]);
    expect(events.some((event) => event.type === 'tool.started' && event.payload.toolName === 'deferred_lookup')).toBe(false);
    expect(modelClient.requests[0].stepSnapshot?.deferredToolNames).toEqual(['deferred_lookup']);
  });

  it('uses the model client to compact context manually', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Context compaction' });
    for (let index = 0; index < 12; index += 1) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: `2026-06-26T00:00:${String(index).padStart(2, '0')}.000Z`,
        payload: {
          message: {
            id: `msg_${index}`,
            role: index % 2 ? 'assistant' : 'user',
            content: `message ${index}`,
            createdAt: `2026-06-26T00:00:${String(index).padStart(2, '0')}.000Z`,
            status: 'complete',
          },
        },
      });
    }
    const modelClient = new ContextCompactionModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new HooksConfigStore({
        PreCompact: [{
          matcher: 'manual',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.hook_event_name !== 'PreCompact' || payload.trigger !== 'manual') process.exit(1); process.stdout.write(JSON.stringify({ systemMessage: 'pre compact warning' })); });"),
            timeoutSec: 5,
          }],
        }],
        PostCompact: [{
          matcher: 'manual',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.hook_event_name !== 'PostCompact' || payload.trigger !== 'manual') process.exit(1); process.stdout.write(JSON.stringify({ systemMessage: 'post compact warning' })); });"),
            timeoutSec: 5,
          }],
        }],
        SessionStart: [{
          matcher: 'compact',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("let input = ''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { const payload = JSON.parse(input); if (payload.source !== 'compact') process.exit(1); process.stdout.write('context from compact hook'); });"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    const compacted = await loop.compactThreadContext(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const compactingEvent = events.find((event) => event.type === 'thread.context_compacting');
    const compactedEvent = events.find((event) => event.type === 'thread.context_compacted');
    const compactTurnId = compactingEvent?.turnId;

    expect(modelClient.requests).toHaveLength(1);
    expect(modelClient.requests[0]).toMatchObject({
      model: 'context-compaction',
      maxOutputTokens: 1600,
      temperature: 0,
      toolChoice: 'none',
    });
    expect(compactingEvent?.turnId).toBeTruthy();
    expect(compactedEvent?.turnId).toBe(compactingEvent?.turnId);
    expect(events).toContainEqual(expect.objectContaining({
      turnId: compactTurnId,
      type: 'turn.started',
      payload: expect.objectContaining({ taskKind: 'compact' }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      turnId: compactTurnId,
      type: 'turn.completed',
      payload: expect.objectContaining({ taskKind: 'compact' }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PreCompact',
        matcher: 'manual',
        status: 'completed',
        entries: [{ kind: 'warning', text: 'pre compact warning' }],
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PostCompact',
        matcher: 'manual',
        status: 'completed',
        entries: [{ kind: 'warning', text: 'post compact warning' }],
      }),
    }));
    const compactedSummary = compacted.messages.find((message) => message.contextCompaction);
    expect(compacted.messages.some((message) => message.id === 'msg_0' && message.visibility === 'transcript')).toBe(true);
    expect(compactedSummary?.contextCompaction?.triggerScopes).toEqual(['manual']);
    expect(compactedSummary?.turnId).toBe(compactedEvent?.turnId);
    expect(compactedSummary?.content).toContain('模型整理后的上下文摘要');

    await loop.sendTurn(thread.id, { input: 'continue after compact' });
    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[1]?.messages.map((message) => message.content).join('\n')).toContain('context from compact hook');
  });

  it('lets PreCompact hooks stop manual context compaction before the model call', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'PreCompact stop' });
    for (let index = 0; index < 12; index += 1) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: `2026-06-26T00:01:${String(index).padStart(2, '0')}.000Z`,
        payload: {
          message: {
            id: `stop_msg_${index}`,
            role: index % 2 ? 'assistant' : 'user',
            content: `message ${index}`,
            createdAt: `2026-06-26T00:01:${String(index).padStart(2, '0')}.000Z`,
            status: 'complete',
          },
        },
      });
    }
    const modelClient = new ContextCompactionModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new HooksConfigStore({
        PreCompact: [{
          matcher: 'manual',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ continue: false, stopReason: 'manual compact paused' }));"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    const compacted = await loop.compactThreadContext(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(modelClient.requests).toHaveLength(0);
    expect(compacted.messages.some((message) => message.contextCompaction)).toBe(false);
    expect(events.some((event) => event.type === 'thread.context_compacted')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.completed',
      payload: expect.objectContaining({ taskKind: 'compact' }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PreCompact',
        status: 'stopped',
        message: 'manual compact paused',
        entries: [{ kind: 'stop', text: 'manual compact paused' }],
      }),
    }));
  });

  it('registers manual context compaction as an active cancellable compact task', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Cancellable context compaction' });
    for (let index = 0; index < 12; index += 1) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: `2026-06-26T00:02:${String(index).padStart(2, '0')}.000Z`,
        payload: {
          message: {
            id: `cancel_compact_msg_${index}`,
            role: index % 2 ? 'assistant' : 'user',
            content: `message ${index}`,
            createdAt: `2026-06-26T00:02:${String(index).padStart(2, '0')}.000Z`,
            status: 'complete',
          },
        },
      });
    }
    const modelClient = new BlockingContextCompactionModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const compacting = loop.compactThreadContext(thread.id);
    await modelClient.started;
    const turnId = loop.activeTurnId(thread.id);

    expect(turnId).toBeTruthy();
    await expect(loop.cancelTurn(thread.id, turnId!)).resolves.toBe(true);
    await expect(compacting).rejects.toMatchObject({ name: 'AbortError' });
    expect(loop.activeTurnId(thread.id)).toBeNull();

    const events = await threadStore.listEvents(thread.id, 0);
    expect(events).toContainEqual(expect.objectContaining({
      turnId,
      type: 'turn.started',
      payload: expect.objectContaining({ taskKind: 'compact' }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      turnId,
      type: 'turn.cancelled',
      payload: expect.objectContaining({ taskKind: 'compact' }),
    }));
  });

  it('automatically compacts oversized context before the next model request', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Automatic context compaction' });
    const oversizedHistory = 'older context '.repeat(90_000);
    for (let index = 0; index < 9; index += 1) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: `2026-06-26T00:00:${String(index).padStart(2, '0')}.000Z`,
        payload: {
          message: {
            id: `msg_${index}`,
            role: index % 2 ? 'assistant' : 'user',
            content: index === 0 ? oversizedHistory : `recent message ${index}`,
            createdAt: `2026-06-26T00:00:${String(index).padStart(2, '0')}.000Z`,
            status: 'complete',
          },
        },
      });
    }
    const modelClient = new AutoCompactionModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await loop.sendTurn(thread.id, { input: 'continue after history' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const compactedEvent = events.find((event) => event.type === 'thread.context_compacted' && event.turnId);
    const mainRequest = modelClient.requests.find((request) => request.model === 'local-runtime-smoke');

    expect(modelClient.requests.map((request) => request.model)).toEqual(['context-compaction', 'local-runtime-smoke']);
    expect(events.some((event) => event.type === 'thread.context_compacting' && event.turnId)).toBe(true);
    expect(compactedEvent?.turnId).toBeTruthy();
    const savedCompactionSummary = saved?.messages.find((message) => message.contextCompaction);
    expect(saved?.messages.some((message) => message.id === 'msg_0' && message.visibility === 'transcript')).toBe(true);
    expect(savedCompactionSummary?.turnId).toBe(compactedEvent?.turnId);
    expect(savedCompactionSummary?.contextCompaction?.triggerScopes).toEqual(['total']);
    expect(savedCompactionSummary?.contextCompaction?.autoCompactTokenLimit).toBeGreaterThan(0);
    expect(savedCompactionSummary?.contextCompaction?.tokensUntilCompaction).toBeGreaterThan(0);
    expect(saved?.contextCompaction?.tokensUntilCompaction).toBe(savedCompactionSummary?.contextCompaction?.tokensUntilCompaction);
    expect(savedCompactionSummary?.content).toContain('<context_compaction_summary');
    expect(saved?.messages.some((message) => message.content === 'continue after history')).toBe(true);
    expect(mainRequest?.messages.some((message) => message.contextCompaction?.triggerScopes?.includes('total'))).toBe(true);
    expect(mainRequest?.stepSnapshot?.contextWindow).toMatchObject({
      compactionHash: expect.stringMatching(/^sha256:/),
      compactionSummaryMessageIds: [savedCompactionSummary?.id],
    });
    expect(mainRequest?.stepSnapshot?.contextWindow?.tokensUntilCompaction).toBeGreaterThan(0);
    expect(mainRequest?.stepSnapshot?.contextWindow?.tokensUntilCompaction).toBeLessThanOrEqual(savedCompactionSummary?.contextCompaction?.tokensUntilCompaction ?? 0);
    expect(mainRequest?.messages.map((message) => message.content).join('\n')).not.toContain(oversizedHistory.slice(0, 200));
  });

  it('uses the active model context window when deciding automatic compaction', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Small window automatic context compaction' });
    const smallWindowHistory = 'older context '.repeat(600);
    for (let index = 0; index < 3; index += 1) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: `2026-06-26T00:00:${String(index).padStart(2, '0')}.000Z`,
        payload: {
          message: {
            id: `small_window_msg_${index}`,
            role: index % 2 ? 'assistant' : 'user',
            content: index === 0 ? smallWindowHistory : `recent message ${index}`,
            createdAt: `2026-06-26T00:00:${String(index).padStart(2, '0')}.000Z`,
            status: 'complete',
          },
        },
      });
    }
    const modelClient = new AutoCompactionModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new ContextWindowConfigStore(1_000),
    });

    await loop.sendTurn(thread.id, { input: 'continue after small-window history' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const compactingEvent = events.find((event) => event.type === 'thread.context_compacting' && event.turnId);
    const mainRequest = modelClient.requests.find((request) => request.model === 'local-runtime-smoke');

    expect(modelClient.requests.map((request) => request.model)).toEqual(['context-compaction', 'local-runtime-smoke']);
    expect(compactingEvent?.payload).toMatchObject({
      maxContextTokens: 1_000,
      maxContextTokensK: 1,
    });
    expect(saved?.messages.find((message) => message.contextCompaction)?.contextCompaction).toMatchObject({
      autoCompactTokenLimit: 850,
      maxContextTokens: 1_000,
      maxContextTokensK: 1,
      tokensUntilCompaction: expect.any(Number),
      triggerScopes: ['total'],
    });
    expect(mainRequest?.messages.some((message) => message.contextCompaction?.maxContextTokens === 1_000)).toBe(true);
    expect(mainRequest?.stepSnapshot?.contextWindow).toMatchObject({
      autoCompactTokenLimit: 850,
      maxContextTokens: 1_000,
      maxContextTokensK: 1,
      compactionHash: expect.stringMatching(/^sha256:/),
    });
    expect(mainRequest?.messages.map((message) => message.content).join('\n')).not.toContain(smallWindowHistory.slice(0, 200));
  });

  it('uses provider-native context compaction when available', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Remote automatic context compaction' });
    const smallWindowHistory = 'remote older context '.repeat(600);
    for (let index = 0; index < 3; index += 1) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: `2026-06-26T00:03:${String(index).padStart(2, '0')}.000Z`,
        payload: {
          message: {
            id: `remote_compact_msg_${index}`,
            role: index % 2 ? 'assistant' : 'user',
            content: index === 0 ? smallWindowHistory : `recent remote message ${index}`,
            createdAt: `2026-06-26T00:03:${String(index).padStart(2, '0')}.000Z`,
            status: 'complete',
          },
        },
      });
    }
    const modelClient = new RemoteCompactionModelClient();
    const usageStore = new CapturingUsageStore();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new ContextWindowConfigStore(1_000),
      usageStore,
    });

    await loop.sendTurn(thread.id, { input: 'continue after remote compaction' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const mainRequest = modelClient.requests.find((request) => request.model === 'local-runtime-smoke');

    expect(modelClient.compactRequests).toHaveLength(1);
    expect(modelClient.compactRequests[0]).toMatchObject({
      model: 'context-compaction',
      maxOutputTokens: 1600,
      temperature: 0,
    });
    expect(modelClient.compactRequests[0].messages.map((message) => message.content).join('\n')).toContain(smallWindowHistory.slice(0, 200));
    expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke']);
    expect(saved?.messages.find((message) => message.contextCompaction)?.contextCompaction).toMatchObject({
      source: 'remote',
      triggerScopes: ['total'],
    });
    expect(mainRequest?.stepSnapshot?.contextWindow).toMatchObject({
      compactionHash: expect.stringMatching(/^sha256:/),
      compactionSummaryMessageIds: [expect.any(String)],
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'token.count',
      payload: {
        usage: {
          provider: 'openai-responses',
          model: 'gpt-compact',
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
        },
      },
    }));
    expect(usageStore.records).toMatchObject([{
      threadId: thread.id,
      provider: 'openai-responses',
      model: 'gpt-compact',
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
    }]);
    expect(mainRequest?.messages.map((message) => message.content).join('\n')).toContain('Remote provider compacted the older history.');
    expect(mainRequest?.messages.map((message) => message.content).join('\n')).not.toContain(smallWindowHistory.slice(0, 200));
  });

  it('automatically compacts oversized mid-turn tool results before follow-up sampling', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Mid-turn context compaction', projectId: 'project_1' });
    const modelClient = new MidTurnToolCompactionModelClient();
    const toolHost = new LargeToolResultHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'read the huge generated report' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const followUpRequest = modelClient.requests[2];

    expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'context-compaction', 'local-runtime-smoke']);
    expect(events.some((event) => event.type === 'thread.context_compacted' && event.turnId)).toBe(true);
    expect(saved?.messages.find((message) => message.role === 'tool')?.visibility).toBe('transcript');
    expect(saved?.messages.some((message) => message.contextCompaction?.triggerScopes?.includes('total'))).toBe(true);
    expect(followUpRequest.messages.some((message) => message.contextCompaction?.triggerScopes?.includes('total'))).toBe(true);
    expect(followUpRequest.stepSnapshot?.contextWindow).toMatchObject({
      compactionHash: expect.stringMatching(/^sha256:/),
      compactionSummaryMessageIds: [expect.any(String)],
    });
    expect(followUpRequest.messages.map((message) => message.content).join('\n')).toContain('Summarized oversized tool output.');
    expect(followUpRequest.messages.map((message) => message.content).join('\n')).not.toContain(toolHost.largeContent.slice(0, 200));
    expect(saved?.messages.at(-1)?.content).toContain('Final answer after summarized tool result.');
  });

  it('lets PreCompact hooks stop automatic compaction and complete the turn without model calls', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Automatic context compaction stop' });
    const oversizedHistory = 'older context '.repeat(90_000);
    for (let index = 0; index < 9; index += 1) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: `2026-06-26T00:02:${String(index).padStart(2, '0')}.000Z`,
        payload: {
          message: {
            id: `auto_stop_msg_${index}`,
            role: index % 2 ? 'assistant' : 'user',
            content: index === 0 ? oversizedHistory : `recent message ${index}`,
            createdAt: `2026-06-26T00:02:${String(index).padStart(2, '0')}.000Z`,
            status: 'complete',
          },
        },
      });
    }
    const modelClient = new AutoCompactionModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new HooksConfigStore({
        PreCompact: [{
          matcher: 'auto',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ continue: false, stopReason: 'auto compact paused' }));"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'continue after history' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(modelClient.requests).toHaveLength(0);
    expect(events.some((event) => event.type === 'thread.context_compacted')).toBe(false);
    expect(saved?.messages.map((message) => message.role).slice(-2)).toEqual(['user', 'assistant']);
    expect(saved?.messages.at(-1)?.content).toBe('auto compact paused');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PreCompact',
        matcher: 'auto',
        status: 'stopped',
        message: 'auto compact paused',
      }),
    }));
  });

  it('forces a final no-tool response when the tool loop reaches its round limit', async () => {
    const maxToolRounds = 3;
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Tool loop limit', projectId: 'project_1' });
    const modelClient = new ToolLoopLimitModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      maxToolRounds,
    });

    await loop.sendTurn(thread.id, { input: 'keep inspecting files' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
    expect(events.some((event) => event.type === 'turn.completed')).toBe(true);
    expect(modelClient.requests.at(-1)?.toolChoice).toBe('none');
    expect(modelClient.requests).toHaveLength(maxToolRounds + 1);
    expect(toolHost.calls).toHaveLength(maxToolRounds);
    expect(events.some((event) =>
      event.type === 'tool.completed'
      && event.payload.status === 'error'
      && event.payload.content.includes('budget')
    )).toBe(false);
    expect(saved?.messages.at(-1)?.content).toBe('Final answer after the available tool results.');
    expect(saved?.messages.at(-1)?.status).toBe('complete');
  }, 20_000);

  it('injects local memories into model context', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Memory loop' });
    await memoryStore.rememberMemory({ content: 'The user prefers local-only runtime answers.' });
    const modelClient = new MemoryCapturingModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
    });

    await loop.sendTurn(thread.id, { input: 'what should you remember?' });

    expect(modelClient.requests[0].messages[0]).toMatchObject({ role: 'system' });
    expect(modelClient.requests[0].messages[0].content).toContain('<memory_context>');
    expect(modelClient.requests[0].messages[0].content).toContain('local-only runtime answers');
    expect(modelClient.requests[0].messages[0].content).toContain('source="MEMORY.md:');
    expect(modelClient.requests[0].messages[0].content).toContain('<oai-mem-citation>');
    expect(modelClient.requests[0].messages[0].content).toContain('========= MEMORY_SUMMARY BEGINS =========');
    expect(modelClient.requests[0].messages[0].content).toContain('<rollout_ids>');
  });

  it('strips hidden memory citations from assistant output and stores citation metadata', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const citedMemory = await memoryStore.rememberMemory({ content: 'Cited local memory.', sourceThreadId: 'thread_a' });
    const thread = await threadStore.createThread({ title: 'Memory citation' });
    const loop = new AgentLoop({
      threadStore,
      modelClient: new MemoryCitationModelClient(),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
    });

    await loop.sendTurn(thread.id, { input: 'answer with citation' });

    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const assistant = saved?.messages.find((message) => message.role === 'assistant');
    expect(assistant?.content).toBe('Answer  done.');
    expect(assistant?.memoryCitation).toEqual({
      entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 2, note: 'summary' }],
      rolloutIds: ['thread_a', 'thread_b'],
    });
    expect(events.filter((event) => event.type === 'message.delta').map((event) => event.payload.text).join('')).toBe('Answer  done.');
    expect(events.find((event) => event.type === 'message.completed')).toMatchObject({
      payload: {
        memoryCitation: {
          entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 2, note: 'summary' }],
          rolloutIds: ['thread_a', 'thread_b'],
        },
      },
    });
    await expect(memoryStore.listMemories()).resolves.toMatchObject({
      memories: expect.arrayContaining([
        expect.objectContaining({ id: citedMemory.id, usageCount: 1, lastUsedAt: expect.any(String) }),
      ]),
    });
  });

  it('stores explicit user memory requests even when the model does not call the memory tool', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Explicit memory', projectId: 'project_1' });
    const loop = new AgentLoop({
      threadStore,
      modelClient: new MemoryCapturingModelClient(),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
    });

    await loop.sendTurn(thread.id, { input: '请记住：这个项目用 pnpm 管理依赖。' });

    await expect(memoryStore.listMemories({ projectId: 'project_1' })).resolves.toMatchObject({
      memories: [
        {
          scope: 'project',
          projectId: 'project_1',
          content: '这个项目用 pnpm 管理依赖',
          sourceThreadId: thread.id,
        },
      ],
    });
  });

  it('does not duplicate explicit memories when the memory tool already saved them', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Memory tool', projectId: 'project_1' });
    const loop = new AgentLoop({
      threadStore,
      modelClient: new RememberMemoryToolModelClient(),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      toolHost: new MemoryToolHost(memoryStore),
    });

    await loop.sendTurn(thread.id, { input: '请记住：这个项目用 pnpm 管理依赖。' });

    const list = await memoryStore.listMemories({ projectId: 'project_1' });
    expect(list.memories).toHaveLength(1);
    expect(list.memories[0]).toMatchObject({
      scope: 'project',
      projectId: 'project_1',
      content: '这个项目用 pnpm 管理依赖。',
      sourceThreadId: thread.id,
    });
  });

  it('injects desktop personalization and honors disabled memories', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Personalization loop' });
    await memoryStore.rememberMemory({ content: 'This memory should stay out.' });
    const modelClient = new MemoryCapturingModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      configStore: new PersonalizationConfigStore(),
    });

    await loop.sendTurn(thread.id, { input: 'how should you answer?' });

    const contents = modelClient.requests[0].messages.map((message) => message.content).join('\n');
    expect(contents).toContain('Desktop personalization:');
    expect(contents).toContain('more everyday, conversational tone');
    expect(contents).toContain('Prefer crisp context before the answer.');
    expect(contents).not.toContain('<memory_context>');
    expect(contents).not.toContain('This memory should stay out.');
  });

  it('extracts passive memories after completed turns without exposing a tool call', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Memory extraction', projectId: 'project_1' });
    const modelClient = new PassiveMemoryModelClient();
    const usageStore = new CapturingUsageStore();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      usageStore,
    });

    await loop.sendTurn(thread.id, { input: '以后记忆生成模型要跟随当前切换的模型。' });

    const preview = await memoryStore.previewMemories();
    expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'passive-memory-extraction']);
    expect(modelClient.requests[1]).toMatchObject({
      maxOutputTokens: 900,
      temperature: 0,
      toolChoice: 'none',
    });
    expect(modelClient.requests[1].tools).toBeUndefined();
    expect(preview.items).toMatchObject([
      {
        title: '记忆模型',
        scope: 'project',
        origin: 'passive',
        projectId: 'project_1',
        source: 'Memory extraction',
        tags: ['memory', 'model'],
      },
    ]);
    expect(preview.items[0].preview).toContain('记忆生成模型要跟随当前切换的模型');
    expect(usageStore.records).toMatchObject([{ provider: 'test-provider', model: 'selected-model' }]);
    await expect(memoryStore.listStage1Outputs()).resolves.toMatchObject({
      outputs: [
        expect.objectContaining({
          threadId: thread.id,
          turnId: expect.any(String),
          projectId: 'project_1',
          rawMemory: expect.stringContaining('以后记忆生成模型要跟随当前切换的模型。'),
          rolloutSummary: expect.stringContaining('用户要求记忆生成模型要跟随当前切换的模型。'),
        }),
      ],
    });
  });

  it('uses the configured model for passive memory extraction', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Memory extraction model', projectId: 'project_1' });
    const modelClient = new PassiveMemoryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      configStore: new MemorySettingsConfigStore({
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: false,
        extractModel: 'memory-extract-model',
      }),
    });

    await loop.sendTurn(thread.id, { input: '以后记忆生成模型要用单独配置的模型。' });

    expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'memory-extract-model']);
    await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 1 });
  });

  it('prefers Codex stage-1 fields from passive memory extraction output', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Codex stage one', projectId: 'project_1' });
    const modelClient = new CodexStage1MemoryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
    });

    await loop.sendTurn(thread.id, { input: '以后记忆生成模型要跟随当前切换的模型。' });

    expect(modelClient.requests[1].messages[0].content).toContain('raw_memory');
    await expect(memoryStore.listStage1Outputs()).resolves.toMatchObject({
      outputs: [
        expect.objectContaining({
          threadId: thread.id,
          status: 'succeeded',
          rawMemory: '## Durable Preference\nUser wants passive memory extraction to follow the currently selected model.',
          rolloutSummary: 'User prefers passive memory extraction to follow the selected model.',
          rolloutSlug: 'memory-model-routing',
        }),
      ],
    });
    await expect(memoryStore.previewMemories()).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          preview: expect.stringContaining('记忆生成模型要跟随当前切换的模型'),
        }),
      ],
    });
    await expect(memoryStore.syncPhase2Workspace()).resolves.toMatchObject({
      hasChanges: true,
      diffPath: 'phase2_workspace_diff.md',
      changes: expect.arrayContaining([
        expect.objectContaining({ path: 'raw_memories.md' }),
      ]),
    });
  });

  it('runs phase-2 consolidation with a locked-down internal memory agent', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Codex phase two', projectId: 'project_1' });
    const modelClient = new ConsolidatingCodexMemoryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      configStore: new ActiveMemorySettingsConfigStore({
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: false,
      }),
    });

    await loop.sendTurn(thread.id, { input: '以后记忆生成模型要跟随当前切换的模型。' });

    expect(modelClient.requests.map((request) => request.model)).toEqual([
      'local-runtime-smoke',
      'passive-memory-extraction',
      'memory-consolidation',
      'memory-consolidation',
    ]);
    expect(modelClient.requests[2].tools?.map((tool) => tool.name)).toEqual([
      'list_directory',
      'read_file',
      'search_text',
      'write_file',
      'delete_file',
    ]);
    await expect(memoryStore.readMemoryFile({ path: 'memory_summary.md' })).resolves.toMatchObject({
      content: expect.stringMatching(/^v1\n/),
    });
    await expect(memoryStore.readMemoryFile({ path: 'MEMORY.md' })).resolves.toMatchObject({
      content: expect.stringContaining('# Task Group: Memory model routing'),
    });
    await expect(memoryStore.syncPhase2Workspace()).resolves.toMatchObject({
      hasChanges: false,
      changes: [],
    });
    await expect(memoryStore.claimPhase2Job({ ownerId: 'after_success', leaseSeconds: 60, retryDelaySeconds: 60 })).resolves.toMatchObject({
      status: 'skipped_no_input',
    });
  });

  it('records startup stage-1 no-output results and skips the same rollout later', async () => {
    const ids = new RandomIdGenerator();
    const clock = new MutableClock('2026-01-01T00:00:00.000Z');
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, clock, ids);
    const memoryStore = new FileMemoryStore(dataDir, clock, ids);
    const thread = await threadStore.createThread({ title: 'No durable memory', projectId: 'project_1' });
    await appendCompletedExchange(threadStore, ids, clock, thread.id, 'turn_empty', '今天随便问一句天气。', '这类实时信息下次应重新查询。');
    clock.set('2026-01-01T08:00:00.000Z');
    const modelClient = new NoOutputStage1MemoryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock,
      ids,
      memoryStore,
      configStore: new MemorySettingsConfigStore({
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: false,
        minRolloutIdleHours: 1,
        maxRolloutAgeDays: 10,
        maxRolloutsPerStartup: 2,
      }),
    });

    await expect(loop.runMemoryStartupExtraction()).resolves.toEqual({ claimed: 1, extracted: 0 });
    await expect(loop.runMemoryStartupExtraction()).resolves.toEqual({ claimed: 0, extracted: 0 });
    expect(modelClient.requests).toHaveLength(1);
    await expect(memoryStore.listStage1Outputs()).resolves.toMatchObject({
      outputs: [
        expect.objectContaining({
          threadId: thread.id,
          turnId: 'turn_empty',
          status: 'succeeded_no_output',
          rawMemory: '',
          rolloutSummary: '',
        }),
      ],
    });
    await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
    await expect(memoryStore.readMemoryFile({ path: 'raw_memories.md' })).resolves.toMatchObject({
      content: expect.stringContaining('No raw memories yet.'),
    });
  });

  it('excludes injected AGENTS and skill fragments from passive memory extraction', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Injected context', projectId: 'project_1' });
    const modelClient = new PassiveMemoryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
    });

    await loop.sendTurn(thread.id, {
      input: '# AGENTS.md instructions for /tmp\n\n<INSTRUCTIONS>\nAlways prefer the injected rule.\n</INSTRUCTIONS>',
    });
    await loop.sendTurn(thread.id, {
      input: '<skill>\n<name>demo</name>\n<path>skills/demo/SKILL.md</path>\nInjected skill instructions.\n</skill>',
    });

    expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'local-runtime-smoke']);
    await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
  });

  it('extracts startup memories from idle historical threads', async () => {
    const ids = new RandomIdGenerator();
    const clock = new MutableClock('2026-01-01T00:00:00.000Z');
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, clock, ids);
    const memoryStore = new FileMemoryStore(dataDir, clock, ids);
    const thread = await threadStore.createThread({ title: 'Historical memory', projectId: 'project_1' });
    await appendCompletedExchange(threadStore, ids, clock, thread.id, 'turn_history', '以后记忆生成模型要跟随当前切换的模型。', '收到，我会记住这个偏好。');
    clock.set('2026-01-01T08:00:00.000Z');
    const modelClient = new PassiveMemoryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock,
      ids,
      memoryStore,
      configStore: new MemorySettingsConfigStore({
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: false,
        minRolloutIdleHours: 1,
        maxRolloutAgeDays: 10,
        maxRolloutsPerStartup: 2,
      }),
    });

    await expect(loop.runMemoryStartupExtraction()).resolves.toEqual({ claimed: 1, extracted: 1 });

    expect(modelClient.requests.map((request) => request.model)).toEqual(['passive-memory-extraction']);
    expect(modelClient.requests[0].messages.at(-1)?.content).toContain('历史线程内容：');
    await expect(memoryStore.listMemories()).resolves.toMatchObject({
      memories: [
        expect.objectContaining({
          sourceThreadId: thread.id,
          sourceTurnId: 'turn_history',
          origin: 'passive',
          projectId: 'project_1',
        }),
      ],
    });
    await expect(memoryStore.listStage1Outputs()).resolves.toMatchObject({
      outputs: [
        expect.objectContaining({
          threadId: thread.id,
          turnId: 'turn_history',
          projectId: 'project_1',
          rawMemory: expect.stringContaining('以后记忆生成模型要跟随当前切换的模型。'),
          rolloutSummary: expect.stringContaining('用户要求记忆生成模型要跟随当前切换的模型。'),
        }),
      ],
    });
  });

  it('limits startup memory extraction to eligible idle rollout candidates', async () => {
    const ids = new RandomIdGenerator();
    const clock = new MutableClock('2026-01-01T00:00:00.000Z');
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, clock, ids);
    const memoryStore = new FileMemoryStore(dataDir, clock, ids);
    const oldThreadA = await threadStore.createThread({ title: 'Old A' });
    await appendCompletedExchange(threadStore, ids, clock, oldThreadA.id, 'turn_old_a', '请记住 A 偏好。', '好的。');
    clock.set('2026-01-01T01:00:00.000Z');
    const oldThreadB = await threadStore.createThread({ title: 'Old B' });
    await appendCompletedExchange(threadStore, ids, clock, oldThreadB.id, 'turn_old_b', '请记住 B 偏好。', '好的。');
    clock.set('2026-01-01T07:30:00.000Z');
    const freshThread = await threadStore.createThread({ title: 'Fresh' });
    await appendCompletedExchange(threadStore, ids, clock, freshThread.id, 'turn_fresh', '这条太新，不应启动抽取。', '好的。');
    clock.set('2026-01-01T08:00:00.000Z');
    const modelClient = new PassiveMemoryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock,
      ids,
      memoryStore,
      configStore: new MemorySettingsConfigStore({
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: false,
        minRolloutIdleHours: 1,
        maxRolloutAgeDays: 10,
        maxRolloutsPerStartup: 1,
      }),
    });

    await expect(loop.runMemoryStartupExtraction()).resolves.toEqual({ claimed: 1, extracted: 1 });

    expect(modelClient.requests).toHaveLength(1);
    const memories = await memoryStore.listMemories();
    expect(memories.memories).toHaveLength(1);
    expect(memories.memories[0].sourceThreadId).not.toBe(freshThread.id);
  });

  it('skips passive memory extraction when the same turn already saved an active memory', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Active memory', projectId: 'project_1' });
    const modelClient = new ActiveMemoryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      toolHost: new MemoryToolHost(memoryStore),
    });

    await loop.sendTurn(thread.id, { input: '请记住，当前仓库的样式需要尽可能使用 UnoCSS。' });

    const preview = await memoryStore.previewMemories();
    expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'local-runtime-smoke']);
    expect(preview.total).toBe(1);
    expect(preview.items).toMatchObject([
      {
        scope: 'project',
        origin: 'active',
        projectId: 'project_1',
        preview: '当前仓库的样式需要尽可能使用 UnoCSS。',
      },
    ]);
  });

  it('skips passive memory extraction when memories are disabled', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Disabled memory extraction' });
    const modelClient = new PassiveMemoryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      configStore: new PersonalizationConfigStore(),
    });

    await loop.sendTurn(thread.id, { input: 'do not extract memory' });

    await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
    expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke']);
  });

  it('does not expose memory tools to the model when memory is disabled', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const configStore = new MemorySettingsConfigStore({
      useMemories: false,
      generateMemories: false,
      dedicatedTools: true,
      disableOnExternalContext: true,
    });
    const thread = await threadStore.createThread({ title: 'Disabled memory tools' });
    await memoryStore.rememberMemory({ content: 'This memory should not be model-visible.' });
    const modelClient = new MemoryCapturingModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      configStore,
      toolHost: new MemoryToolHost(memoryStore, configStore),
    });

    await loop.sendTurn(thread.id, { input: 'do not use memory tools' });

    const toolNames = (modelClient.requests[0].tools ?? []).map((tool) => tool.name);
    expect(toolNames).not.toEqual(expect.arrayContaining(['remember_memory', 'recall_memory', 'list_memory_files', 'read_memory_file', 'search_memory_files']));
    expect(modelClient.requests[0].messages.map((message) => message.content).join('\n')).not.toContain('Memory tools read');
    expect(modelClient.requests[0].messages.map((message) => message.content).join('\n')).not.toContain('This memory should not be model-visible.');
  });

  it('can use memories without generating new memories', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Read-only memory' });
    await memoryStore.rememberMemory({ content: 'The user wants concise verification notes.' });
    const modelClient = new PassiveMemoryModelClient();
    const configStore = new MemorySettingsConfigStore({
      useMemories: true,
      generateMemories: false,
      dedicatedTools: true,
      disableOnExternalContext: true,
    });
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      configStore,
      toolHost: new MemoryToolHost(memoryStore, configStore),
    });

    await loop.sendTurn(thread.id, { input: 'answer using memory but do not extract' });

    expect(modelClient.requests).toHaveLength(1);
    expect(modelClient.requests[0].messages.map((message) => message.content).join('\n')).toContain('concise verification notes');
    expect((modelClient.requests[0].tools ?? []).map((tool) => tool.name)).toEqual(expect.arrayContaining(['recall_memory', 'list_memory_files', 'read_memory_file', 'search_memory_files']));
    expect((modelClient.requests[0].tools ?? []).map((tool) => tool.name)).not.toContain('remember_memory');
    await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 1 });
  });

  it('marks threads polluted after successful MCP tools and skips passive memory extraction', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'External context', memoryMode: 'enabled' });
    const modelClient = new ExternalContextMemoryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      toolHost: new ExternalContextToolHost(),
      configStore: new MemorySettingsConfigStore({
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      }),
    });

    await loop.sendTurn(thread.id, { input: 'search external context' });

    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id);
    expect(saved?.memoryMode).toBe('polluted');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'thread.memory_mode_updated',
        payload: {
          mode: 'polluted',
          reason: 'external_context:mcp__search__fetch',
        },
      }),
    ]));
    expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'local-runtime-smoke']);
    await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
  });

  it('marks threads polluted when tool output contains external context', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
    const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'External output marker', memoryMode: 'enabled' });
    const modelClient = new ExternalContextMemoryModelClient('external_search');
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      memoryStore,
      toolHost: new ExternalContextToolHost('external_search', true),
      configStore: new MemorySettingsConfigStore({
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      }),
    });

    await loop.sendTurn(thread.id, { input: 'search external context' });

    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id);
    expect(saved?.memoryMode).toBe('polluted');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'thread.memory_mode_updated',
        payload: {
          mode: 'polluted',
          reason: 'external_context:external_search',
        },
      }),
    ]));
    await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
  });

  it('passes per-turn thinking options and stores reasoning deltas', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Thinking loop' });
    const modelClient = new ReasoningModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await loop.sendTurn(thread.id, { input: 'think first', thinking: true, thinkingEffort: 'max' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id);
    const assistant = saved?.messages.find((message) => message.role === 'assistant');
    const agentItemStarted = events.find((event) => event.type === 'item.started'
      && event.payload.item.kind === 'agent_message'
      && event.payload.item.transcriptMessageId === assistant?.id);
    const reasoningItemStarted = events.find((event) => event.type === 'item.started'
      && event.payload.item.kind === 'reasoning'
      && event.payload.item.transcriptMessageId === assistant?.id);

    expect(modelClient.requests[0]).toMatchObject({ thinking: true, reasoningEffort: 'max' });
    expect(assistant?.content).toBe('<think>plan</think>answer');
    expect(agentItemStarted).toBeTruthy();
    expect(reasoningItemStarted).toBeTruthy();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'reasoning.raw_delta',
      payload: expect.objectContaining({ itemId: `${assistant?.id}:reasoning`, delta: 'plan' }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'item.delta',
      payload: { itemId: assistant?.id, delta: 'answer' },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'token.count',
      payload: { usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
    }));
  });

  it('rejects image attachments when the active model does not support image input', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Image support' });
    const modelClient = new ToolCallingModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new ImageCapabilityConfigStore(false),
    });

    await expect(loop.sendTurn(thread.id, {
      input: 'look at this',
      attachments: [
        {
          id: 'image_1',
          name: 'diagram.png',
          type: 'image/png',
          size: 12,
          url: 'data:image/png;base64,aW1hZ2U=',
        },
      ],
    })).rejects.toThrow('当前模型未启用图片输入。');

    expect(modelClient.requests).toHaveLength(0);
  });

  it('pauses tool execution until approval is answered', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Approval loop' });
    const modelClient = new ApprovalToolModelClient();
    const toolHost = new ApprovalToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run risky tool' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(toolHost.calls).toEqual([]);
    expect(pendingApproval.toolName).toBe('dangerous_tool');

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('approved result'))).toBe(true);
    const startedIndex = events.findIndex((event) => event.type === 'tool.started' && event.payload.toolName === 'dangerous_tool');
    const approvalIndex = events.findIndex((event) => event.type === 'approval.requested');
    expect(startedIndex).toBeGreaterThanOrEqual(0);
    expect(approvalIndex).toBeGreaterThanOrEqual(0);
    expect(startedIndex).toBeLessThan(approvalIndex);
    expect(events.some((event) => event.type === 'approval.requested')).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed' && event.payload.status === 'success')).toBe(true);
  });

  it('persists tool approvals across loop instances', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Persistent approval loop' });
    const persistentToolApprovalStore = new InMemoryPersistentToolApprovalStore();
    const approvalKeys = ['mcp:search:write_note'];
    const firstModelClient = new ApprovalToolModelClient();
    const firstToolHost = new ApprovalToolHost({
      approvalKeys,
      persistentApprovalKeys: approvalKeys,
    });
    const firstApprovalGate = new InMemoryApprovalGate(systemClock, ids);
    const firstLoop = new AgentLoop({
      threadStore,
      modelClient: firstModelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: firstToolHost,
      approvalGate: firstApprovalGate,
      persistentToolApprovalStore,
    });

    const pendingTurn = firstLoop.sendTurn(thread.id, { input: 'run risky MCP tool and remember' });
    const pendingApproval = await waitForPendingApproval(firstApprovalGate);
    expect(pendingApproval.availableDecisions).toEqual([
      { type: 'approve' },
      { type: 'approve_for_session' },
      { type: 'approve_persistently' },
      { type: 'reject' },
    ]);
    await firstApprovalGate.answerApproval(pendingApproval.id, { decision: 'approve_persistently' });
    await pendingTurn;

    const secondToolHost = new ApprovalToolHost({
      approvalKeys,
      persistentApprovalKeys: approvalKeys,
    });
    const secondApprovalGate = new InMemoryApprovalGate(systemClock, ids);
    const secondLoop = new AgentLoop({
      threadStore,
      modelClient: new ApprovalToolModelClient(),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: secondToolHost,
      approvalGate: secondApprovalGate,
      persistentToolApprovalStore,
    });

    await secondLoop.sendTurn(thread.id, { input: 'run risky MCP tool again' });

    expect(firstToolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
    expect(secondToolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
    await expect(persistentToolApprovalStore.hasAll(approvalKeys)).resolves.toBe(true);
    await expect(secondApprovalGate.listApprovals()).resolves.toEqual({ approvals: [] });
  });

  it('cancels the active turn when command approval is cancelled', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Approval cancel loop' });
    const modelClient = new ApprovalToolModelClient();
    const toolHost = new ApprovalToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run risky tool then cancel' });
    const pendingApproval = await waitForPendingApproval(approvalGate);
    await approvalGate.answerApproval(pendingApproval.id, { decision: 'cancel' });
    await pendingTurn;
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([]);
    expect(events.some((event) => event.type === 'approval.resolved' && event.payload.approvalId === pendingApproval.id && event.payload.decision === 'cancel')).toBe(true);
    expect(events.some((event) => event.type === 'turn.cancelled' && event.payload.reason?.includes('approval decision'))).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed' && event.payload.toolName === 'dangerous_tool')).toBe(false);
    expect(modelClient.requests).toHaveLength(1);
  });

  it('runs exec_command with require_escalated as a bypassed sandbox attempt after approval', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Escalated exec loop' });
    const modelClient = new EscalatedExecModelClient();
    const toolHost = new EscalatedExecToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run escalated command' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(pendingApproval.toolName).toBe('exec_command');
    expect(pendingApproval.reason).toContain('needs unsandboxed access');

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;

    expect(toolHost.attempts).toEqual(['bypass']);
    expect(modelClient.requests).toHaveLength(2);
  });

  it('reuses exec prefix_rule approvals for matching require_escalated commands', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Escalated prefix exec loop' });
    const modelClient = new RepeatedEscalatedPrefixExecModelClient();
    const toolHost = new EscalatedExecToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const policyAmendmentStore = new InMemoryPolicyAmendmentStore();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      policyAmendmentStore,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run escalated prefix commands' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(pendingApproval.toolName).toBe('exec_command');
    expect(pendingApproval.proposedExecPolicyAmendment).toEqual(['git', 'status']);
    expect(pendingApproval.availableDecisions).toEqual([
      { type: 'approve' },
      { type: 'approve_exec_policy_amendment', proposedExecPolicyAmendment: ['git', 'status'] },
      { type: 'reject' },
    ]);
    const approvalRun = await waitForApprovalToolRun(
      threadStore,
      thread.id,
      pendingApproval.id,
      (run) => Array.isArray(run.proposedExecPolicyAmendment),
    );
    expect(approvalRun?.proposedExecPolicyAmendment).toEqual(['git', 'status']);
    expect(approvalRun?.availableApprovalDecisions).toEqual(pendingApproval.availableDecisions);
    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_exec_policy_amendment' });
    await pendingTurn;
    const approvals = await approvalGate.listApprovals();
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.attempts).toEqual(['bypass', 'bypass']);
    expect(approvals.approvals).toHaveLength(1);
    expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
    expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_exec_policy_amendment')).toBe(true);
    await expect(policyAmendmentStore.listPolicyAmendments()).resolves.toMatchObject({
      execPolicyAmendments: [['git', 'status']],
    });
  });

  it('does not reuse banned broad exec prefix_rule approvals', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Broad prefix exec loop' });
    const modelClient = new BroadEscalatedPrefixExecModelClient();
    const toolHost = new EscalatedExecToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run broad prefix commands' });
    const firstApproval = await waitForPendingApproval(approvalGate);

    expect(firstApproval.toolName).toBe('exec_command');
    expect(firstApproval.proposedExecPolicyAmendment).toBeUndefined();
    await approvalGate.answerApproval(firstApproval.id, { decision: 'approve_for_session' });
    const secondApproval = await waitForPendingApproval(approvalGate);
    expect(secondApproval.id).not.toBe(firstApproval.id);
    expect(secondApproval.toolName).toBe('exec_command');
    await approvalGate.answerApproval(secondApproval.id, { decision: 'approve' });
    await pendingTurn;

    const events = await threadStore.listEvents(thread.id, 0);
    expect(toolHost.attempts).toEqual(['bypass', 'bypass']);
    expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(2);
  });

  it('runs exec_command with approved additional sandbox permissions', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Additional permissions exec loop', projectId: 'project_1' });
    const environmentCwd = await mkDataDir();
    const expectedWritableRoot = path.join(environmentCwd, 'extra-write');
    const modelClient = new RepeatedAdditionalPermissionsExecModelClient('extra-write');
    const toolHost = new AdditionalPermissionsExecToolHost(environmentCwd);
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run command with additional permissions twice' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(pendingApproval.toolName).toBe('exec_command');
    expect(pendingApproval.reason).toContain('Additional sandbox permissions requested');
    expect(pendingApproval.reason).toContain('network access');
    expect(pendingApproval.reason).toContain(expectedWritableRoot);
    expect(pendingApproval.environmentId).toBe('project_1');
    expect(pendingApproval.additionalPermissions).toEqual({
      network: { enabled: true },
      file_system: {
        write: [expectedWritableRoot],
        entries: [{
          path: { type: 'path', path: expectedWritableRoot },
          access: 'write',
        }],
      },
    });

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
    await pendingTurn;
    const approvals = await approvalGate.listApprovals();
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.contexts).toHaveLength(2);
    expect(toolHost.contexts.every((context) => context.sandbox?.mode === 'default')).toBe(true);
    expect(toolHost.contexts.every((context) => context.sandboxWorkspaceWrite?.networkAccess === true)).toBe(true);
    expect(toolHost.contexts.every((context) => context.sandboxWorkspaceWrite?.writableRoots?.includes(expectedWritableRoot))).toBe(true);
    expect(approvals.approvals).toHaveLength(1);
    expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
    expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_for_session')).toBe(true);
  });

  it('applies request_permissions grants to later exec_command calls in the same turn', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Request permissions loop', projectId: 'project_1' });
    const environmentCwd = await mkDataDir();
    const grantedRoot = 'relative-grant';
    const deniedRoot = 'blocked-grant';
    const deniedSpecialRoot = 'blocked-special';
    const deniedGlobPattern = '**/*.env';
    const expectedGrantedRoot = path.join(environmentCwd, grantedRoot);
    const expectedDeniedRoot = path.join(environmentCwd, deniedRoot);
    const expectedDeniedSpecialRoot = path.join(environmentCwd, deniedSpecialRoot);
    const expectedDeniedGlobPattern = path.join(environmentCwd, deniedGlobPattern);
    const modelClient = new RequestPermissionsThenExecModelClient(grantedRoot, {
      deniedRoot,
      deniedSpecialRoot,
      deniedGlobPattern,
    });
    const toolHost = new RequestPermissionsExecToolHost(environmentCwd);
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new ReadOnlyConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'request permission then run command' });
    const pendingApproval = await waitForPendingApproval(approvalGate);
    expect(pendingApproval).toMatchObject({
      toolName: 'request_permissions',
      status: 'pending',
      permissionApprovalContext: {
        cwd: environmentCwd,
        environmentId: 'project_1',
        availableScopes: ['turn', 'session'],
      },
    });
    expect(pendingApproval.permissionApprovalContext?.grantedPermissions).toMatchObject({
      network: { enabled: true },
    });

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;
    const saved = await threadStore.getThread(thread.id);
    const approvalRun = saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'request_permissions');

    expect(toolHost.contexts).toHaveLength(1);
    expect(toolHost.contexts[0].permissionProfile).toBe('read-only');
    expect(toolHost.contexts[0].sandbox?.networkAccess).toBe('enabled');
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.readableRoots).toContain(expectedGrantedRoot);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toContain(expectedGrantedRoot);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.deniedRoots).toContain(expectedDeniedRoot);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.deniedRoots).toContain(expectedDeniedSpecialRoot);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.deniedGlobPatterns).toContain(expectedDeniedGlobPattern);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.networkAccess).toBe(true);
    expect(approvalRun?.permissionApprovalContext?.cwd).toBe(environmentCwd);
    expect(approvalRun?.permissionApprovalContext?.grantedPermissions).toMatchObject({
      file_system: { read: [expectedGrantedRoot], write: [expectedGrantedRoot] },
    });
    expect(approvalRun?.permissionApprovalContext?.grantedPermissions).toMatchObject({
      file_system: {
        entries: expect.arrayContaining([
          { path: { type: 'path', path: expectedDeniedRoot }, access: 'deny' },
          { path: { type: 'path', path: expectedDeniedSpecialRoot }, access: 'deny' },
          { path: { type: 'glob_pattern', pattern: expectedDeniedGlobPattern }, access: 'deny' },
        ]),
      },
    });
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && contentIncludesPath(message.content, expectedGrantedRoot))).toBe(true);
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"scope":"turn"'))).toBe(true);
  });

  it('auto-denies request_permissions when the feature is disabled', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Disabled request permissions loop', projectId: 'project_1' });
    const environmentCwd = await mkDataDir();
    const modelClient = new RequestPermissionsThenExecModelClient('disabled-grant');
    const toolHost = new RequestPermissionsExecToolHost(environmentCwd);
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new RequestPermissionsDisabledConfigStore(),
    });

    await loop.sendTurn(thread.id, { input: 'request permission while disabled' });

    await expect(approvalGate.listApprovals()).resolves.toEqual({ approvals: [] });
    expect(toolHost.contexts).toHaveLength(1);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toBeUndefined();
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.readableRoots).toBeUndefined();
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.networkAccess).toBeUndefined();
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"permissions":{}'))).toBe(true);
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"scope":"turn"'))).toBe(true);
  });

  it('clamps request_permissions approval grants to the originally requested permissions', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Clamped request permissions loop', projectId: 'project_1' });
    const environmentCwd = await mkDataDir();
    const grantedRoot = 'requested-grant';
    const requestedRoot = path.join(environmentCwd, grantedRoot);
    const modelClient = new RequestPermissionsThenExecModelClient(grantedRoot);
    const toolHost = new RequestPermissionsExecToolHost(environmentCwd);
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new ReadOnlyConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'request permission then clamp the grant' });
    const pendingApproval = await waitForPendingApproval(approvalGate);
    await approvalGate.answerApproval(pendingApproval.id, {
      decision: 'approve_for_session',
      permissionGrant: {
        permissions: {
          network: { enabled: true },
          file_system: {
            write: [environmentCwd],
            read: [environmentCwd],
          },
        },
        scope: 'session',
      },
    });
    await pendingTurn;

    expect(toolHost.contexts).toHaveLength(1);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toEqual([requestedRoot]);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.readableRoots).toEqual([requestedRoot]);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.networkAccess).toBe(true);
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && contentIncludesPath(message.content, requestedRoot))).toBe(true);
    expect(modelClient.requests[1].messages.some((message) =>
      message.role === 'tool'
      && contentIncludesPath(message.content, environmentCwd)
      && !contentIncludesPath(message.content, requestedRoot)
    )).toBe(false);
  });

  it('enables strict auto review for later tools in the same request_permissions turn', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Strict request permissions loop', projectId: 'project_1' });
    const environmentCwd = await mkDataDir();
    const grantedRoot = 'strict-grant';
    const modelClient = new RequestPermissionsThenExecModelClient(grantedRoot);
    const toolHost = new RequestPermissionsExecToolHost(environmentCwd);
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new ReadOnlyConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'request permission then strictly review command' });
    const permissionsApproval = await waitForPendingApproval(approvalGate);
    expect(permissionsApproval.toolName).toBe('request_permissions');
    expect(permissionsApproval.availableDecisions).toEqual([
      { type: 'approve' },
      { type: 'approve_for_turn_with_strict_auto_review' },
      { type: 'approve_for_session' },
      { type: 'reject' },
    ]);

    await approvalGate.answerApproval(permissionsApproval.id, { decision: 'approve_for_turn_with_strict_auto_review' });
    const execApproval = await waitForPendingApproval(approvalGate);
    expect(execApproval.id).not.toBe(permissionsApproval.id);
    expect(execApproval.toolName).toBe('exec_command');
    expect(execApproval.reason).toContain('Strict auto review');

    await approvalGate.answerApproval(execApproval.id, { decision: 'approve' });
    await pendingTurn;

    const approvals = await approvalGate.listApprovals();
    expect(approvals.approvals.map((approval) => approval.toolName)).toEqual(['exec_command', 'request_permissions']);
    expect(toolHost.contexts).toHaveLength(1);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toContain(path.join(environmentCwd, grantedRoot));
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"strict_auto_review":true'))).toBe(true);
  });

  it('normalizes session-scoped strict request_permissions responses to an empty turn grant', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Invalid strict session permissions loop', projectId: 'project_1' });
    const environmentCwd = await mkDataDir();
    const grantedRoot = 'strict-session-grant';
    const modelClient = new RequestPermissionsThenExecModelClient(grantedRoot);
    const toolHost = new RequestPermissionsExecToolHost(environmentCwd);
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new ReadOnlyConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'request invalid strict session permissions' });
    const pendingApproval = await waitForPendingApproval(approvalGate);
    await approvalGate.answerApproval(pendingApproval.id, {
      decision: 'approve_for_session',
      permissionGrant: {
        permissions: {
          network: { enabled: true },
          file_system: { write: [path.join(environmentCwd, grantedRoot)] },
        },
        scope: 'session',
        strictAutoReview: true,
      },
    });
    await pendingTurn;

    expect(toolHost.contexts).toHaveLength(1);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toBeUndefined();
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.networkAccess).toBeUndefined();
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"permissions":{}'))).toBe(true);
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"scope":"turn"'))).toBe(true);
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"strict_auto_review":false'))).toBe(true);
  });

  it('keeps request_permissions grants when approved for session', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Session request permissions loop', projectId: 'project_1' });
    const grantedRoot = path.join(await mkDataDir(), 'setsuna-request-permissions-session');
    const modelClient = new SessionRequestPermissionsModelClient(grantedRoot);
    const toolHost = new RequestPermissionsExecToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const firstTurn = loop.sendTurn(thread.id, { input: 'request session permission' });
    const pendingApproval = await waitForPendingApproval(approvalGate);
    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
    await firstTurn;

    await loop.sendTurn(thread.id, { input: 'reuse session permission' });

    const approvals = await approvalGate.listApprovals();
    expect(approvals.approvals).toHaveLength(1);
    expect(toolHost.contexts).toHaveLength(1);
    expect(toolHost.contexts[0].sandboxWorkspaceWrite?.writableRoots).toContain(grantedRoot);
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('"scope":"session"'))).toBe(true);
  });

  it('rejects additional sandbox write permissions for protected metadata', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Protected additional permissions loop', projectId: 'project_1' });
    const modelClient = new ProtectedAdditionalPermissionsExecModelClient();
    const toolHost = new AdditionalPermissionsExecToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    await loop.sendTurn(thread.id, { input: 'run command with unsafe additional permissions' });
    const approvals = await approvalGate.listApprovals();
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.contexts).toHaveLength(0);
    expect(approvals.approvals).toHaveLength(0);
    expect(events.some((event) =>
      event.type === 'tool.completed'
      && event.payload.toolName === 'exec_command'
      && event.payload.status === 'rejected'
      && event.payload.content.includes('protected workspace metadata')
    )).toBe(true);
  });

  it('retries a sandbox-denied tool after bypass approval', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Sandbox retry loop' });
    const modelClient = new SandboxDeniedModelClient();
    const toolHost = new SandboxRetryToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run sandboxed tool' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(toolHost.attempts).toEqual(['default']);
    expect(pendingApproval.toolName).toBe('sandboxed_tool');
    expect(pendingApproval.reason).toContain('Sandbox denied sandboxed_tool');

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.attempts).toEqual(['default', 'bypass']);
    expect(events.some((event) => event.type === 'approval.resolved' && event.payload.approvalId === pendingApproval.id && event.payload.decision === 'approve')).toBe(true);
    expect(events.some((event) =>
      event.type === 'tool.completed'
      && event.payload.toolName === 'sandboxed_tool'
      && event.payload.status === 'success'
      && event.payload.content.includes('retried without sandbox')
    )).toBe(true);
  });

  it('caches sandbox retry approvals when approved for session', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Session sandbox retry loop' });
    const modelClient = new RepeatedSandboxDeniedModelClient();
    const toolHost = new SandboxRetryToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run sandboxed tool twice' });
    const pendingApproval = await waitForPendingApproval(approvalGate);
    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
    await pendingTurn;
    const approvals = await approvalGate.listApprovals();
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.attempts).toEqual(['default', 'bypass', 'default', 'bypass']);
    expect(modelClient.requests).toHaveLength(3);
    expect(approvals.approvals).toHaveLength(1);
    expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
    expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_for_session')).toBe(true);
  });

  it('retries a network-denied tool after network approval', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Network retry loop' });
    const modelClient = new NetworkDeniedModelClient();
    const toolHost = new NetworkRetryToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run network tool' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(toolHost.attempts).toEqual(['default']);
    expect(pendingApproval.toolName).toBe('network_tool');
    expect(pendingApproval.reason).toContain('Network access is blocked for network_tool');

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.attempts).toEqual(['default', 'enabled']);
    expect(events.some((event) => event.type === 'approval.resolved' && event.payload.approvalId === pendingApproval.id && event.payload.decision === 'approve')).toBe(true);
    expect(events.some((event) =>
      event.type === 'tool.completed'
      && event.payload.toolName === 'network_tool'
      && event.payload.status === 'success'
      && event.payload.content.includes('retried with network')
    )).toBe(true);
  });

  it('preserves require_escalated sandbox intent when retrying after network approval', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Escalated network retry loop' });
    const modelClient = new EscalatedNetworkDeniedModelClient();
    const toolHost = new EscalatedNetworkRetryToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run escalated network command' });
    const execApproval = await waitForPendingApproval(approvalGate);
    expect(execApproval.reason).toContain('needs unsandboxed network access');
    await approvalGate.answerApproval(execApproval.id, { decision: 'approve' });
    const networkApproval = await waitForPendingApproval(approvalGate);
    expect(networkApproval.reason).toContain('Network access');
    await approvalGate.answerApproval(networkApproval.id, { decision: 'approve' });
    await pendingTurn;

    expect(toolHost.attempts).toEqual([
      { mode: 'bypass', networkAccess: 'default' },
      { mode: 'bypass', networkAccess: 'enabled' },
    ]);
  });

  it('caches network retry approvals when approved for session', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Session network approval loop' });
    const modelClient = new RepeatedNetworkDeniedModelClient();
    const toolHost = new NetworkRetryToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run network tool twice' });
    const pendingApproval = await waitForPendingApproval(approvalGate);
    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
    await pendingTurn;
    const approvals = await approvalGate.listApprovals();
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.attempts).toEqual(['default', 'enabled', 'enabled']);
    expect(modelClient.requests).toHaveLength(3);
    expect(approvals.approvals).toHaveLength(1);
    expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
    expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_for_session')).toBe(true);
  });

  it('caches network approvals by host context for shell commands', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Host network approval loop', projectId: 'project_1' });
    const modelClient = new RepeatedHostNetworkShellModelClient();
    const toolHost = new ShellNetworkRetryToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const policyAmendmentStore = new InMemoryPolicyAmendmentStore();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      policyAmendmentStore,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'fetch two URLs from the same host' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(pendingApproval.toolName).toBe('run_shell_command');
    expect(pendingApproval.reason).toContain('https://api.example.com:443');
    expect(pendingApproval.argumentsPreview).toContain('network-access');
    expect(pendingApproval.networkApprovalContext).toEqual({
      host: 'api.example.com',
      protocol: 'https',
      port: 443,
      target: 'https://api.example.com:443',
    });
    expect(pendingApproval.proposedNetworkPolicyAmendments).toEqual([
      { host: 'api.example.com', action: 'allow' },
      { host: 'api.example.com', action: 'deny' },
    ]);
    expect(pendingApproval.availableDecisions).toEqual([
      { type: 'approve' },
      { type: 'approve_for_session' },
      { type: 'approve_network_policy_amendment', networkPolicyAmendment: { host: 'api.example.com', action: 'allow' } },
      { type: 'approve_network_policy_amendment', networkPolicyAmendment: { host: 'api.example.com', action: 'deny' } },
      { type: 'reject' },
    ]);
    const approvalRun = await waitForApprovalToolRun(
      threadStore,
      thread.id,
      pendingApproval.id,
      (run) => Boolean(run.networkApprovalContext && run.proposedNetworkPolicyAmendments && run.availableApprovalDecisions),
    );
    expect(approvalRun?.networkApprovalContext).toEqual(pendingApproval.networkApprovalContext);
    expect(approvalRun?.proposedNetworkPolicyAmendments).toEqual(pendingApproval.proposedNetworkPolicyAmendments);
    expect(approvalRun?.availableApprovalDecisions).toEqual(pendingApproval.availableDecisions);

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_network_policy_amendment' });
    await pendingTurn;
    const approvals = await approvalGate.listApprovals();
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.attempts).toEqual([
      { command: 'curl https://api.example.com/a', networkAccess: 'default' },
      { command: 'curl https://api.example.com/a', networkAccess: 'enabled' },
      { command: 'curl https://api.example.com/b', networkAccess: 'enabled' },
    ]);
    expect(approvals.approvals).toHaveLength(1);
    expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
    expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_network_policy_amendment')).toBe(true);
    await expect(policyAmendmentStore.listPolicyAmendments()).resolves.toMatchObject({
      networkPolicyAmendments: [{ host: 'api.example.com', action: 'allow' }],
    });
  });

  it('persists network deny amendments and skips later prompts for the same host', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Host network deny policy loop', projectId: 'project_1' });
    const modelClient = new RepeatedHostNetworkShellModelClient();
    const policyAmendmentStore = new InMemoryPolicyAmendmentStore();
    const toolHost = new PolicyAwareShellNetworkRetryToolHost(policyAmendmentStore);
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      policyAmendmentStore,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'deny repeated host network commands' });
    const pendingApproval = await waitForPendingApproval(approvalGate);
    await approvalGate.answerApproval(pendingApproval.id, {
      decision: 'approve_network_policy_amendment',
      networkPolicyAmendment: { host: 'api.example.com', action: 'deny' },
    });
    await pendingTurn;

    const approvals = await approvalGate.listApprovals();
    const events = await threadStore.listEvents(thread.id, 0);
    expect(toolHost.attempts).toEqual([
      { command: 'curl https://api.example.com/a', networkAccess: 'default' },
      { command: 'curl https://api.example.com/b', networkAccess: 'default' },
    ]);
    expect(approvals.approvals).toHaveLength(1);
    expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool.completed' && event.payload.status === 'error')).toHaveLength(2);
    await expect(policyAmendmentStore.listPolicyAmendments()).resolves.toMatchObject({
      networkPolicyAmendments: [{ host: 'api.example.com', action: 'deny' }],
    });
  });

  it('requires approval for every tool when approval policy is strict', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Strict approval loop', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new StrictApprovalConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'read README strictly' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(toolHost.calls).toEqual([]);
    expect(pendingApproval.toolName).toBe('workspace_read_file');
    expect(pendingApproval.reason).toContain('Strict approval policy');

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;

    expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
  });

  it('lets PermissionRequest hooks approve tools before user approval UI', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Permission hook allow' });
    const modelClient = new ApprovalToolModelClient();
    const toolHost = new ApprovalToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new HooksConfigStore({
        PermissionRequest: [{
          matcher: 'dangerous_tool',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }));"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'run risky tool with hook allow' });
    const saved = await threadStore.getThread(thread.id);
    const approvals = await approvalGate.listApprovals();
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
    expect(approvals.approvals).toEqual([]);
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PermissionRequest',
        toolName: 'dangerous_tool',
        status: 'completed',
        message: 'Approved by hook.',
      }),
    }));
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'dangerous_tool')?.hookRuns).toMatchObject([
      { eventName: 'PermissionRequest', status: 'completed', message: 'Approved by hook.' },
    ]);
  });

  it('lets PermissionRequest hooks deny tools before user approval UI', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Permission hook deny' });
    const modelClient = new ApprovalToolModelClient();
    const toolHost = new ApprovalToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new HooksConfigStore({
        PermissionRequest: [{
          matcher: 'dangerous_tool',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'denied by permission hook' } } }));"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    await loop.sendTurn(thread.id, { input: 'run risky tool with hook deny' });
    const saved = await threadStore.getThread(thread.id);
    const approvals = await approvalGate.listApprovals();
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([]);
    expect(approvals.approvals).toEqual([]);
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      payload: expect.objectContaining({
        toolName: 'dangerous_tool',
        status: 'rejected',
        content: expect.stringContaining('denied by permission hook'),
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PermissionRequest',
        toolName: 'dangerous_tool',
        status: 'blocked',
        message: 'denied by permission hook',
        entries: [{ kind: 'feedback', text: 'denied by permission hook' }],
      }),
    }));
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'dangerous_tool')?.hookRuns).toMatchObject([
      { eventName: 'PermissionRequest', status: 'blocked', message: 'denied by permission hook', entries: [{ kind: 'feedback', text: 'denied by permission hook' }] },
    ]);
  });

  it('marks invalid PermissionRequest hook output as failed and continues to approval UI', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Permission hook invalid' });
    const modelClient = new ApprovalToolModelClient();
    const toolHost = new ApprovalToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new HooksConfigStore({
        PermissionRequest: [{
          matcher: 'dangerous_tool',
          hooks: [{
            type: 'command',
            command: nodeEvalHook("process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: {} } } }));"),
            timeoutSec: 5,
          }],
        }],
      }),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run risky tool with invalid hook allow' });
    const pendingApproval = await waitForPendingApproval(approvalGate);
    const eventsBeforeApproval = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([]);
    expect(pendingApproval.toolName).toBe('dangerous_tool');
    expect(eventsBeforeApproval).toContainEqual(expect.objectContaining({
      type: 'hook.completed',
      payload: expect.objectContaining({
        eventName: 'PermissionRequest',
        toolName: 'dangerous_tool',
        status: 'failed',
        message: 'PermissionRequest hook returned unsupported updatedInput',
        entries: [{ kind: 'error', text: 'PermissionRequest hook returned unsupported updatedInput' }],
      }),
    }));

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;
    const saved = await threadStore.getThread(thread.id);

    expect(toolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? []).find((run) => run.name === 'dangerous_tool')?.hookRuns).toMatchObject([
      { eventName: 'PermissionRequest', status: 'failed', message: 'PermissionRequest hook returned unsupported updatedInput', entries: [{ kind: 'error', text: 'PermissionRequest hook returned unsupported updatedInput' }] },
    ]);
  });

  it('routes strict file mutations through the tool orchestrator approval flow', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Strict file write loop' });
    const modelClient = new ToolDeltaModelClient();
    const toolHost = new PreviewingToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new StrictApprovalConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'write file strictly' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(toolHost.calls).toBe(0);
    expect(pendingApproval.toolName).toBe('write_file');
    expect(pendingApproval.reason).toContain('Strict approval policy');

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;
    const events = await threadStore.listEvents(thread.id, 0);
    const approvals = await approvalGate.listApprovals();

    expect(approvals.approvals).toHaveLength(1);
    expect(approvals.approvals[0]).toMatchObject({ toolName: 'write_file', status: 'approved' });
    expect(events.some((event) => event.type === 'approval.requested')).toBe(true);
    expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve')).toBe(true);
    expect(events.some((event) =>
      event.type === 'tool.completed'
      && event.payload.toolName === 'write_file'
      && event.payload.status === 'success'
    )).toBe(true);
  });

  it('caches strict file mutation approvals only when approved for session', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Session file approval loop' });
    const modelClient = new RepeatedFileWriteModelClient();
    const toolHost = new PreviewingToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new StrictApprovalConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'write same file twice with session approval' });
    const pendingApproval = await waitForPendingApproval(approvalGate);
    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve_for_session' });
    await pendingTurn;

    const events = await threadStore.listEvents(thread.id, 0);
    const approvals = await approvalGate.listApprovals();

    expect(toolHost.calls).toBe(2);
    expect(approvals.approvals).toHaveLength(1);
    expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(1);
    expect(events.some((event) => event.type === 'approval.resolved' && event.payload.decision === 'approve_for_session')).toBe(true);
    expect(events.filter((event) => event.type === 'tool.completed' && event.payload.toolName === 'write_file' && event.payload.status === 'success')).toHaveLength(2);
  });

  it('does not cache strict file mutation approvals for one-time approvals', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'One-time file approval loop' });
    const modelClient = new RepeatedFileWriteModelClient();
    const toolHost = new PreviewingToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new StrictApprovalConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'write same file twice with one-time approval' });
    const firstApproval = await waitForPendingApproval(approvalGate);
    await approvalGate.answerApproval(firstApproval.id, { decision: 'approve' });
    const secondApproval = await waitForPendingApproval(approvalGate);
    await approvalGate.answerApproval(secondApproval.id, { decision: 'approve' });
    await pendingTurn;

    const events = await threadStore.listEvents(thread.id, 0);
    const approvals = await approvalGate.listApprovals();

    expect(toolHost.calls).toBe(2);
    expect(approvals.approvals).toHaveLength(2);
    expect(events.filter((event) => event.type === 'approval.requested')).toHaveLength(2);
  });

  it('rejects file mutations before execution in read-only permission profile', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Read-only file write loop' });
    const modelClient = new ToolDeltaModelClient();
    const toolHost = new PreviewingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      configStore: new ReadOnlyConfigStore(),
    });

    await loop.sendTurn(thread.id, { input: 'write file read-only' });
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toBe(0);
    expect(events.some((event) =>
      event.type === 'tool.completed'
      && event.payload.toolName === 'write_file'
      && event.payload.status === 'rejected'
      && event.payload.content.includes('read-only permission profile')
    )).toBe(true);
  });

  it('rejects protected workspace metadata file mutations before execution', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Protected metadata write loop' });
    const modelClient = new ProtectedMetadataWriteModelClient();
    const toolHost = new PreviewingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'write git config' });
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toBe(0);
    expect(events.some((event) =>
      event.type === 'tool.completed'
      && event.payload.toolName === 'write_file'
      && event.payload.status === 'rejected'
      && event.payload.content.includes('protected workspace metadata')
    )).toBe(true);
  });

  it('intercepts shell apply_patch commands into the file mutation approval path', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Shell patch loop' });
    const modelClient = new ShellApplyPatchModelClient('src/from-shell.txt');
    const toolHost = new ShellApplyPatchInterceptHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new StrictApprovalConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'apply patch through shell' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(toolHost.calls).toEqual([]);
    expect(pendingApproval.toolName).toBe('apply_patch');
    expect(pendingApproval.argumentsPreview).toContain('src/from-shell.txt');

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([
      {
        name: 'apply_patch',
        input: expect.objectContaining({
          patch: expect.stringContaining('src/from-shell.txt'),
          intercepted_from_shell_command: true,
        }),
      },
    ]);
    expect(events.some((event) => event.type === 'tool.started' && event.payload.toolName === 'apply_patch')).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed' && event.payload.toolName === 'apply_patch' && event.payload.status === 'success')).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed' && event.payload.toolName === 'run_shell_command')).toBe(false);
  });

  it('preserves shell cd workdir when intercepting apply_patch commands', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Shell cd patch loop' });
    const modelClient = new ShellApplyPatchModelClient('from-shell-cd.txt', 'cd src && ');
    const toolHost = new ShellApplyPatchInterceptHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new StrictApprovalConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'apply patch through shell cd' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(pendingApproval.toolName).toBe('apply_patch');
    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;

    expect(toolHost.calls).toEqual([
      {
        name: 'apply_patch',
        input: expect.objectContaining({
          patch: expect.stringContaining('from-shell-cd.txt'),
          workdir: 'src',
          intercepted_from_shell_command: true,
        }),
      },
    ]);
  });

  it('intercepts shell applypatch alias commands into apply_patch', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Shell applypatch alias loop' });
    const modelClient = new ShellApplyPatchModelClient('src/from-alias.txt', '', 'applypatch');
    const toolHost = new ShellApplyPatchInterceptHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new StrictApprovalConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'apply patch through shell alias' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(pendingApproval.toolName).toBe('apply_patch');
    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;

    expect(toolHost.calls).toEqual([
      {
        name: 'apply_patch',
        input: expect.objectContaining({
          patch: expect.stringContaining('src/from-alias.txt'),
          intercepted_from_shell_command: true,
        }),
      },
    ]);
  });

  it('rejects protected workspace metadata writes hidden in shell apply_patch commands', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Protected shell patch loop' });
    const modelClient = new ShellApplyPatchModelClient('.git/config');
    const toolHost = new ShellApplyPatchInterceptHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'hide git write in shell patch' });
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([]);
    expect(events.some((event) =>
      event.type === 'tool.completed'
      && event.payload.toolName === 'apply_patch'
      && event.payload.status === 'rejected'
      && event.payload.content.includes('protected workspace metadata')
    )).toBe(true);
  });

  it('does not intercept ordinary shell commands that merely mention apply_patch', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Shell search loop' });
    const modelClient = new ShellMentionApplyPatchModelClient();
    const toolHost = new ShellApplyPatchInterceptHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'search for apply_patch' });
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([
      {
        name: 'run_shell_command',
        input: expect.objectContaining({ command: 'rg apply_patch' }),
      },
    ]);
    expect(events.some((event) => event.type === 'tool.completed' && event.payload.toolName === 'run_shell_command' && event.payload.status === 'success')).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed' && event.payload.toolName === 'apply_patch')).toBe(false);
  });

  it('skips tool approvals when approval policy is full', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Full approval loop' });
    const modelClient = new ApprovalToolModelClient();
    const toolHost = new ApprovalToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new FullApprovalConfigStore(),
    });

    await loop.sendTurn(thread.id, { input: 'run risky tool without confirmation' });
    const events = await threadStore.listEvents(thread.id, 0);
    const approvals = await approvalGate.listApprovals();

    expect(approvals.approvals).toEqual([]);
    expect(toolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
  });

  it('cancels active turns without publishing runtime errors', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Cancel loop' });
    const modelClient = new CancellableModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const started = await loop.startTurn(thread.id, { input: 'keep going until cancelled' });
    await waitForModelRequest(modelClient);
    await modelClient.waitUntilAbortListenerReady();

    await expect(loop.cancelTurn(thread.id, started.turnId)).resolves.toBe(true);
    const events = await waitForTurnCancelled(threadStore, thread.id);
    const saved = await threadStore.getThread(thread.id);
    const markerIndex = events.findIndex((event) => event.type === 'message.created'
      && event.turnId === started.turnId
      && event.payload.message.role === 'user'
      && event.payload.message.visibility === 'model'
      && event.payload.message.content.includes('<turn_aborted>'));
    const cancelledIndex = events.findIndex((event) => event.type === 'turn.cancelled' && event.turnId === started.turnId);

    await waitForModelAbort(modelClient);
    expect(modelClient.aborted).toBe(true);
    expect(events.some((event) => event.type === 'turn.cancelled' && event.turnId === started.turnId)).toBe(true);
    expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(cancelledIndex).toBeGreaterThan(markerIndex);
    expect(saved?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        turnId: started.turnId,
        role: 'user',
        visibility: 'model',
        content: expect.stringContaining('<turn_aborted>'),
      }),
    ]));
    expect(saved?.messages.at(-1)?.status).toBe('complete');
  });

  it('publishes cancellation immediately when a model stream ignores abort', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Non-cooperative cancel' });
    const modelClient = new NonCooperativeCancellationModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const started = await loop.startTurn(thread.id, { input: 'start and hang' });
    await waitForModelRequest(modelClient);
    await modelClient.waitUntilAbortListenerReady();

    await expect(loop.cancelTurn(thread.id, started.turnId)).resolves.toBe(true);

    const events = await threadStore.listEvents(thread.id, 0);
    const saved = await threadStore.getThread(thread.id);
    await waitForModelAbort(modelClient);
    expect(modelClient.aborted).toBe(true);
    expect(events.filter((event) => event.type === 'turn.cancelled' && event.turnId === started.turnId)).toHaveLength(1);
    expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
    expect(saved?.activeTurnId).toBeNull();
    expect(saved?.messages.find((message) => message.role === 'assistant' && message.turnId === started.turnId)?.status).toBe('complete');
  });

  it('does not wait for tool runtimes that opt out of cancellation waiting', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Non waiting tool cancel', projectId: 'project_1' });
    const toolHost = new NonWaitingCancellationToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient: new SingleToolCallModelClient({ id: 'call_background', name: 'background_tool', arguments: '{}' }),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    const running = loop.sendTurn(thread.id, { input: 'start background tool' });
    await toolHost.started;
    const turnId = loop.activeTurnId(thread.id);

    expect(turnId).toBeTruthy();
    await expect(loop.cancelTurn(thread.id, turnId!)).resolves.toBe(true);
    await expect(Promise.race([
      running.then(() => 'finished'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 500)),
    ])).resolves.toBe('finished');
    expect(loop.activeTurnId(thread.id)).toBeNull();
    toolHost.release();
    await toolHost.done;

    const events = await threadStore.listEvents(thread.id, 0);
    expect(events.some((event) => event.type === 'tool.started' && event.payload.toolName === 'background_tool')).toBe(true);
    expect(events.some((event) => event.type === 'turn.cancelled' && event.turnId === turnId)).toBe(true);
    expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
  });

  it('runs standalone user shell commands as cancellable user_shell tasks', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'User shell task', projectId: 'project_1' });
    const toolHost = new BlockingUserShellHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient: new SteerableModelClient(),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    const running = loop.runUserShellCommand(thread.id, 'node -e "setTimeout(() => {}, 10000)"');
    await toolHost.started;
    const turnId = loop.activeTurnId(thread.id);

    expect(turnId).toBeTruthy();
    expect(toolHost.calls).toEqual([{
      command: 'node -e "setTimeout(() => {}, 10000)"',
      projectId: 'project_1',
      turnId,
    }]);

    await expect(loop.cancelTurn(thread.id, turnId!)).resolves.toBe(true);
    await expect(running).resolves.toBeUndefined();
    expect(loop.activeTurnId(thread.id)).toBeNull();

    const events = await threadStore.listEvents(thread.id, 0);
    const markerIndex = events.findIndex((event) => event.type === 'message.created'
      && event.turnId === turnId
      && event.payload.message.role === 'user'
      && event.payload.message.visibility === 'model'
      && event.payload.message.content.includes('<turn_aborted>'));
    const cancelledIndex = events.findIndex((event) => event.type === 'turn.cancelled' && event.turnId === turnId);
    expect(events).toContainEqual(expect.objectContaining({
      turnId,
      type: 'turn.started',
      payload: expect.objectContaining({ taskKind: 'user_shell' }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      turnId,
      type: 'tool.started',
      payload: expect.objectContaining({ source: 'userShell' }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      turnId,
      type: 'turn.cancelled',
      payload: expect.objectContaining({ taskKind: 'user_shell' }),
    }));
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(cancelledIndex).toBeGreaterThan(markerIndex);
  });

  it('queues mailbox input that arrives while a user_shell task is active', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Busy shell mailbox queue', projectId: 'project_1' });
    const modelClient = new MailboxAwareModelClient();
    const toolHost = new BlockingUserShellHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    const running = loop.runUserShellCommand(thread.id, 'node -e "setTimeout(() => {}, 10000)"');
    await toolHost.started;
    const shellTurnId = loop.activeTurnId(thread.id);
    expect(shellTurnId).toBeTruthy();

    await expect(loop.deliverMailboxInput(thread.id, {
      id: 'mail_shell_expected',
      expectedTurnId: shellTurnId!,
      fromAgentId: 'agent_child',
      content: 'this should not attach to a shell task',
    })).rejects.toThrow('active user_shell turn cannot receive mailbox input');

    await expect(loop.deliverMailboxInput(thread.id, {
      id: 'mail_shell_queue',
      fromAgentId: 'agent_child',
      content: 'queue this until the shell finishes',
    })).resolves.toEqual({ accepted: true, queued: true, turnId: null });

    const queuedEvents = await threadStore.listEvents(thread.id, 0);
    const mailboxEvent = queuedEvents.find((event) =>
      event.type === 'mailbox.delivered' && event.payload.id === 'mail_shell_queue'
    );
    expect(mailboxEvent?.turnId).toBeUndefined();

    await expect(loop.cancelTurn(thread.id, shellTurnId!)).resolves.toBe(true);
    await expect(running).resolves.toBeUndefined();
    await loop.sendTurn(thread.id, { input: 'continue after shell' });

    const requestText = modelClient.requests[0].messages.map((message) => message.content).join('\n');
    expect(requestText).toContain('<mailbox_message id="mail_shell_queue" from_agent_id="agent_child" delivery_mode="queue_only">');
    expect(requestText).toContain('queue this until the shell finishes');
  });

  it('steers active user input into the next model request of the same turn', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Steer loop' });
    const modelClient = new SteerableModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const started = await loop.startTurn(thread.id, { input: 'initial prompt' });
    await waitForModelRequestCount(modelClient, 1);

    await expect(loop.steerTurn(thread.id, {
      clientId: 'client-steer-1',
      expectedTurnId: started.turnId,
      input: 'Prefer the shorter path.',
    })).resolves.toEqual({ accepted: true, turnId: started.turnId });
    const steeredBeforeRelease = await threadStore.getThread(thread.id);
    expect(steeredBeforeRelease?.messages.find((message) => message.clientId === 'client-steer-1')).toMatchObject({
      content: 'Prefer the shorter path.',
      role: 'user',
      turnId: started.turnId,
    });

    modelClient.releaseFirstResponse();
    const events = await waitForTurnCompleted(threadStore, thread.id, started.turnId);
    const saved = await threadStore.getThread(thread.id);
    const secondTurnMessages = modelClient.requests[1].messages.filter((message) => message.turnId === started.turnId);
    const modelSteerMessage = secondTurnMessages.find((message) => message.clientId === 'client-steer-1');

    expect(modelClient.requests).toHaveLength(2);
    expect(secondTurnMessages.slice(0, 2).map((message) => `${message.role}:${message.content}`)).toEqual([
      'user:initial prompt',
      'assistant:initial answer',
    ]);
    expect(modelSteerMessage).toMatchObject({ role: 'user' });
    expect(modelSteerMessage?.content).toBe('Prefer the shorter path.');
    expect(modelClient.requests[1].stepSnapshot?.inputMessageIds).toEqual(
      secondTurnMessages.filter((message) => message.role === 'user').map((message) => message.id),
    );
    expect(modelClient.requests[1].stepSnapshot?.conversationMessageIds).toContain(modelSteerMessage?.id);
    expect(saved?.messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      'user:initial prompt',
      'assistant:initial answer',
      'user:Prefer the shorter path.',
      'assistant:guided answer',
    ]);
    expect(saved?.messages.find((message) => message.clientId === 'client-steer-1')).toMatchObject({
      role: 'user',
      turnId: started.turnId,
    });
    expect(events.filter((event) => event.type === 'turn.completed' && event.turnId === started.turnId)).toHaveLength(1);
  });

  it('compacts oversized active steer input before the follow-up sampling step', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Oversized steer loop' });
    const modelClient = new OversizedSteerCompactionModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new ContextWindowConfigStore(1_000),
    });
    const oversizedSteer = 'OVERSIZED_STEER_DETAIL '.repeat(800);
    const storedOversizedSteer = oversizedSteer.trim();

    const started = await loop.startTurn(thread.id, { input: 'initial prompt' });
    await waitForModelRequestCount(modelClient, 1);
    await expect(loop.steerTurn(thread.id, {
      clientId: 'client-oversized-steer',
      expectedTurnId: started.turnId,
      input: oversizedSteer,
    })).resolves.toEqual({ accepted: true, turnId: started.turnId });

    modelClient.releaseFirstResponse();
    await waitForTurnCompleted(threadStore, thread.id, started.turnId);
    const saved = await threadStore.getThread(thread.id);
    const compactRequest = modelClient.requests.find((request) => request.model === 'context-compaction');
    const followUpRequest = modelClient.requests.at(-1);
    const savedSteer = saved?.messages.find((message) => message.clientId === 'client-oversized-steer');

    expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'context-compaction', 'local-runtime-smoke']);
    expect(compactRequest?.messages.map((message) => message.content).join('\n')).toContain(oversizedSteer.slice(0, 200));
    expect(savedSteer).toMatchObject({
      content: storedOversizedSteer,
      role: 'user',
      visibility: 'transcript',
    });
    expect(followUpRequest?.messages.some((message) => message.contextCompaction?.triggerScopes?.includes('latest_input'))).toBe(true);
    expect(followUpRequest?.messages.map((message) => message.content).join('\n')).toContain('Summarized oversized steer input.');
    expect(followUpRequest?.messages.map((message) => message.content).join('\n')).not.toContain(oversizedSteer.slice(0, 200));
    expect(followUpRequest?.stepSnapshot?.inputMessageIds).toContain(savedSteer?.id);
    expect(followUpRequest?.stepSnapshot?.conversationMessageIds).toContain(savedSteer?.id);
    expect(followUpRequest?.stepSnapshot?.contextWindow).toMatchObject({
      autoCompactTokenLimit: 850,
      compactionHash: expect.stringMatching(/^sha256:/),
      tokensUntilCompaction: expect.any(Number),
    });
    expect(followUpRequest?.stepSnapshot?.contextWindow?.tokensUntilCompaction).toBeGreaterThan(0);
  });

  it('treats a new start request during an active conversation as a steer', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Start while active' });
    const modelClient = new SteerableModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const started = await loop.startTurn(thread.id, { input: 'initial prompt' });
    await waitForModelRequestCount(modelClient, 1);

    await expect(loop.startTurn(thread.id, {
      clientId: 'client-start-while-active',
      input: 'Treat this as guidance.',
    })).resolves.toEqual({ accepted: true, turnId: started.turnId });

    const steeredBeforeRelease = await threadStore.getThread(thread.id);
    expect(steeredBeforeRelease?.messages.find((message) => message.clientId === 'client-start-while-active')).toMatchObject({
      content: 'Treat this as guidance.',
      role: 'user',
      turnId: started.turnId,
    });

    modelClient.releaseFirstResponse();
    await waitForTurnCompleted(threadStore, thread.id, started.turnId);

    expect(modelClient.requests).toHaveLength(2);
    const secondTurnMessages = modelClient.requests[1].messages.filter((message) => message.turnId === started.turnId);
    const modelSteerMessage = secondTurnMessages.find((message) => message.clientId === 'client-start-while-active');
    expect(secondTurnMessages.slice(0, 2).map((message) => `${message.role}:${message.content}`)).toEqual([
      'user:initial prompt',
      'assistant:initial answer',
    ]);
    expect(modelSteerMessage).toMatchObject({ role: 'user' });
    expect(modelSteerMessage?.content).toBe('Treat this as guidance.');
  });

  it('publishes steered input immediately but queues it behind the current tool result for the next model request', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Steer during tool loop', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new BlockingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    const started = await loop.startTurn(thread.id, { input: 'read README' });
    await toolHost.started;

    await expect(loop.steerTurn(thread.id, {
      clientId: 'client-steer-during-tool',
      expectedTurnId: started.turnId,
      input: 'Prefer the shorter path.',
    })).resolves.toEqual({ accepted: true, turnId: started.turnId });
    const eventsBeforeToolRelease = await threadStore.listEvents(thread.id, 0);
    expect(eventsBeforeToolRelease.some((event) =>
      event.type === 'message.created' && event.payload.message.clientId === 'client-steer-during-tool',
    )).toBe(true);

    toolHost.release();
    const events = await waitForTurnCompleted(threadStore, thread.id, started.turnId);
    const toolCompletedIndex = events.findIndex((event) => event.type === 'tool.completed' && event.payload.toolName === 'workspace_read_file');
    const steerCreatedIndex = events.findIndex((event) =>
      event.type === 'message.created' && event.payload.message.clientId === 'client-steer-during-tool',
    );
    const secondRequestMessages = modelClient.requests[1].messages.filter((message) => message.turnId === started.turnId);
    const toolMessageIndex = secondRequestMessages.findIndex((message) => message.role === 'tool');
    const steerMessageIndex = secondRequestMessages.findIndex((message) => message.clientId === 'client-steer-during-tool');

    expect(toolCompletedIndex).toBeGreaterThanOrEqual(0);
    expect(steerCreatedIndex).toBeGreaterThanOrEqual(0);
    expect(steerCreatedIndex).toBeLessThan(toolCompletedIndex);
    expect(toolMessageIndex).toBeGreaterThanOrEqual(0);
    expect(steerMessageIndex).toBeGreaterThan(toolMessageIndex);
    expect(secondRequestMessages[steerMessageIndex]?.content).toBe('Prefer the shorter path.');
    expect(modelClient.requests[1].stepSnapshot?.inputMessageIds).toContain(secondRequestMessages[steerMessageIndex]?.id);
    expect(modelClient.requests[1].stepSnapshot?.conversationMessageIds).toContain(secondRequestMessages[steerMessageIndex]?.id);
  });

  it('waits for an accepted steer message to be stored before the final drain closes the turn', async () => {
    const ids = new RandomIdGenerator();
    const innerThreadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const threadStore = new DelayedSteerAppendThreadStore(innerThreadStore, 'client-delayed-steer');
    const thread = await threadStore.createThread({ title: 'Delayed steer append' });
    const modelClient = new SteerableModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const started = await loop.startTurn(thread.id, { input: 'initial prompt' });
    await waitForModelRequestCount(modelClient, 1);

    const steer = loop.steerTurn(thread.id, {
      clientId: 'client-delayed-steer',
      expectedTurnId: started.turnId,
      input: 'Do not finish before this is stored.',
    });
    await threadStore.steerAppendStarted;

    modelClient.releaseFirstResponse();
    threadStore.releaseSteerAppend();

    await expect(steer).resolves.toEqual({ accepted: true, turnId: started.turnId });
    await waitForTurnCompleted(threadStore, thread.id, started.turnId);

    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[1].messages.find((message) => message.clientId === 'client-delayed-steer')).toMatchObject({
      content: 'Do not finish before this is stored.',
      role: 'user',
    });
  });

  it('delivers mailbox input into the next model request within the active turn', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Mailbox loop' });
    const modelClient = new SteerableModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const started = await loop.startTurn(thread.id, { input: 'initial prompt' });
    await waitForModelRequestCount(modelClient, 1);

    await expect(loop.deliverMailboxInput(thread.id, {
      id: 'mail_1',
      fromAgentId: 'agent_child',
      expectedTurnId: started.turnId,
      content: 'child agent found the auth regression',
    })).resolves.toEqual({ accepted: true, turnId: started.turnId });

    modelClient.releaseFirstResponse();
    const events = await waitForTurnCompleted(threadStore, thread.id, started.turnId);
    const secondRequestText = modelClient.requests[1].messages.map((message) => message.content).join('\n');

    expect(events).toContainEqual(expect.objectContaining({
      type: 'mailbox.delivered',
      payload: expect.objectContaining({
        id: 'mail_1',
        fromAgentId: 'agent_child',
        content: 'child agent found the auth regression',
      }),
    }));
    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[1].messages.find((message) => message.id === 'mailbox_mail_1')).toMatchObject({
      role: 'system',
      visibility: 'model',
      turnId: started.turnId,
    });
    expect(modelClient.requests[1].stepSnapshot?.inputMessageIds).toEqual(expect.arrayContaining(['mailbox_mail_1']));
    expect(secondRequestText).toContain('<mailbox_message id="mail_1" from_agent_id="agent_child" delivery_mode="queue_only">');
    expect(secondRequestText).toContain('child agent found the auth regression');
  });

  it('queues idle mailbox input for the next user-started model request', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Queued mailbox loop' });
    const modelClient = new MailboxAwareModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await expect(loop.deliverMailboxInput(thread.id, {
      id: 'mail_queue_1',
      fromAgentId: 'agent_child',
      fromThreadId: 'thread_child',
      toAgentId: 'agent_parent',
      content: 'queue this before the next user turn',
    })).resolves.toEqual({ accepted: true, queued: true, turnId: null });

    await loop.sendTurn(thread.id, { input: 'continue with queued mailbox' });
    const events = await threadStore.listEvents(thread.id, 0);
    const firstRequestText = modelClient.requests[0].messages.map((message) => message.content).join('\n');
    const mailboxEvent = events.find((event) => event.type === 'mailbox.delivered');

    expect(mailboxEvent?.turnId).toBeUndefined();
    expect(mailboxEvent?.payload).toEqual(expect.objectContaining({
      deliveryMode: 'queue_only',
      fromAgentId: 'agent_child',
      fromThreadId: 'thread_child',
      toAgentId: 'agent_parent',
    }));
    expect(firstRequestText).toContain('<mailbox_message id="mail_queue_1" from_agent_id="agent_child" from_thread_id="thread_child" to_agent_id="agent_parent" delivery_mode="queue_only">');
    expect(firstRequestText).toContain('queue this before the next user turn');
    expect(firstRequestText).toContain('continue with queued mailbox');
  });

  it('starts a trigger-turn mailbox delivery when the thread is idle', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Trigger mailbox loop' });
    const modelClient = new MailboxAwareModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const delivered = await loop.deliverMailboxInput(thread.id, {
      id: 'mail_trigger_1',
      deliveryMode: 'trigger_turn',
      fromAgentId: 'agent_child',
      content: 'wake the parent agent',
    });

    expect(delivered.turnId).toBeTruthy();
    const events = await waitForTurnCompleted(threadStore, thread.id, delivered.turnId!);
    const requestText = modelClient.requests[0].messages.map((message) => message.content).join('\n');
    const saved = await threadStore.getThread(thread.id);

    expect(events).toContainEqual(expect.objectContaining({
      turnId: delivered.turnId,
      type: 'mailbox.delivered',
      payload: expect.objectContaining({
        deliveryMode: 'trigger_turn',
        triggerTurn: true,
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      turnId: delivered.turnId,
      type: 'turn.started',
      payload: expect.objectContaining({ taskKind: 'regular' }),
    }));
    expect(requestText).toContain('<mailbox_message id="mail_trigger_1" from_agent_id="agent_child" delivery_mode="trigger_turn" trigger_turn="true">');
    expect(requestText).toContain('wake the parent agent');
    expect(saved?.messages.filter((message) => message.turnId === delivered.turnId && message.role === 'user')).toHaveLength(0);
  });

  it('runs built-in collaboration tools across spawned child threads', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const parent = await threadStore.createThread({ title: 'Parent collaboration loop', projectId: 'project_1' });
    const modelClient = new CollaborationToolModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new MultiAgentConfigStore(),
    });

    await loop.sendTurn(parent.id, { input: 'coordinate child agent work' });

    const children = await threadStore.listThreads({ includeArchived: true, parentThreadId: parent.id });
    const child = children[0] ? await threadStore.getThread(children[0].id) : null;
    const parentEvents = await threadStore.listEvents(parent.id, 0);
    const childEvents = child ? await threadStore.listEvents(child.id, 0) : [];

    expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual([
      'spawn_agent',
      'send_input',
      'resume_agent',
      'wait',
      'close_agent',
    ]);
    expect(child).toMatchObject({ parentThreadId: parent.id, projectId: 'project_1' });
    expect(parentEvents.filter((event) => event.type === 'item.completed').map((event) => event.payload.item.kind)).toEqual(expect.arrayContaining([
      'collab_tool_call',
    ]));
    expect(parentEvents.filter((event) => event.type === 'tool.completed').map((event) => event.payload.toolName)).toEqual([
      'spawn_agent',
      'send_input',
      'resume_agent',
      'wait',
      'close_agent',
    ]);
    expect(childEvents.filter((event) => event.type === 'mailbox.delivered').map((event) => event.payload.deliveryMode)).toEqual([
      'queue_only',
      'trigger_turn',
    ]);
    expect(child?.messages.some((message) => message.role === 'assistant' && message.content.includes('Child resumed with mailbox.'))).toBe(true);
    expect((await threadStore.getThread(parent.id))?.messages.at(-1)?.content).toBe('Parent completed collaboration.');
  });

  it('keeps assistant history populated when the model streams item-based content', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Item stream loop' });
    const modelClient = new ItemBasedModelClient();
    const usageStore = new CapturingUsageStore();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      usageStore,
    });

    await loop.sendTurn(thread.id, { input: 'stream using response items' });
    const events = await threadStore.listEvents(thread.id, 0);
    const saved = await threadStore.getThread(thread.id);
    const assistant = saved?.messages.find((message) => message.role === 'assistant');

    expect(assistant?.content).toBe('<think>Need context.</think>Hello from item stream.');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'item.started',
      payload: { item: { id: 'agent_item_1', kind: 'agent_message', status: 'in_progress' } },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'plan.delta',
      payload: { itemId: 'plan_item_1', delta: '1. Inspect state.' },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'reasoning.summary_delta',
      payload: { itemId: 'reasoning_item_1', delta: 'Need context.', summaryIndex: 0 },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'reasoning.summary_part_added',
      payload: { itemId: 'reasoning_item_1', summaryIndex: 0 },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'token.count',
      payload: { usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 }, modelContextWindow: 128000 },
    }));
    expect(saved?.turns?.[0]).toMatchObject({
      id: expect.any(String),
      status: 'completed',
      diff: 'diff --git a/README.md b/README.md\n+Hello',
      items: [
        { id: 'plan_item_1', kind: 'plan', content: '1. Inspect state.' },
        { id: 'reasoning_item_1', kind: 'reasoning', status: 'completed', content: 'Need context.' },
        { id: 'agent_item_1', kind: 'agent_message', status: 'completed', content: 'Hello from item stream.' },
      ],
    });
    expect(saved?.turns?.[0]?.tokenCounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        modelContextWindow: 128000,
      }),
    ]));
    expect(usageStore.records).toMatchObject([{
      threadId: thread.id,
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
    }]);
  });

  it('executes tool calls surfaced as native stream items', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Native item tool loop', projectId: 'project_1' });
    const modelClient = new NativeItemToolCallModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'read README via native item' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('file contents'))).toBe(true);
    expect(saved?.messages.at(-1)?.content).toBe('Native item tool result handled.');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'item.started',
      payload: {
        item: {
          id: 'call_native_1',
          kind: 'tool_call',
          status: 'in_progress',
          toolCall: { id: 'call_native_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
        },
      },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'item.completed',
      payload: {
        item: {
          id: 'call_native_1',
          kind: 'tool_call',
          status: 'completed',
          toolCall: { id: 'call_native_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
        },
      },
    }));
  });

  it('edits a user message, truncates following replies, and regenerates without duplicating the user turn', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Regenerate loop' });
    const modelClient = new RegenerateModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await loop.sendTurn(thread.id, { input: 'original prompt' });
    const firstSaved = await threadStore.getThread(thread.id);
    const userMessageId = firstSaved?.messages.find((message) => message.role === 'user')?.id;
    if (!userMessageId) throw new Error('Expected a user message to regenerate.');

    const regenerated = await loop.regenerateFromMessage(thread.id, userMessageId, { content: 'edited prompt' });
    await waitForTurnCompleted(threadStore, thread.id, regenerated.turnId);
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(saved?.messages[0]).toMatchObject({ id: userMessageId, content: 'edited prompt' });
    expect(saved?.messages[1]?.content).toBe('answer 2');
    expect(modelClient.requests[1].messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([
      'edited prompt',
    ]);
    expect(events.some((event) => event.type === 'message.updated')).toBe(true);
    expect(events.some((event) => event.type === 'messages.truncated')).toBe(true);
    expect(events.filter((event) => event.type === 'message.created' && event.payload.message.role === 'user')).toHaveLength(1);
  });
});

class ToolCallingModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'I read the file.' };
    yield {
      type: 'usage',
      usage: {
        provider: 'test-provider',
        model: 'test-model',
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
      },
    };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ItemBasedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'plan_delta', itemId: 'plan_item_1', text: '1. Inspect state.' };
    yield {
      type: 'item_started',
      item: { id: 'reasoning_item_1', kind: 'reasoning', status: 'in_progress' },
    };
    yield { type: 'reasoning_summary_part_added', itemId: 'reasoning_item_1', summaryIndex: 0 };
    yield { type: 'reasoning_summary_delta', itemId: 'reasoning_item_1', text: 'Need context.', summaryIndex: 0 };
    yield {
      type: 'item_completed',
      item: { id: 'reasoning_item_1', kind: 'reasoning', content: 'Need context.', status: 'completed' },
    };
    yield {
      type: 'item_started',
      item: { id: 'agent_item_1', kind: 'agent_message', status: 'in_progress' },
    };
    yield { type: 'item_delta', itemId: 'agent_item_1', delta: 'Hello ' };
    yield { type: 'item_delta', itemId: 'agent_item_1', delta: 'from item stream.' };
    yield {
      type: 'item_completed',
      item: { id: 'agent_item_1', kind: 'agent_message', content: 'Hello from item stream.', status: 'completed' },
    };
    yield {
      type: 'token_count',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      modelContextWindow: 128000,
    };
    yield { type: 'turn_diff', unifiedDiff: 'diff --git a/README.md b/README.md\n+Hello\n' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class NativeItemToolCallModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      const toolCall = { id: 'call_native_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' };
      yield {
        type: 'item_started',
        item: { id: toolCall.id, kind: 'tool_call', status: 'in_progress', toolCall },
      };
      yield {
        type: 'item_completed',
        item: { id: toolCall.id, kind: 'tool_call', status: 'completed', toolCall },
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield {
      type: 'item_started',
      item: { id: 'agent_native_1', kind: 'agent_message', status: 'in_progress' },
    };
    yield { type: 'item_delta', itemId: 'agent_native_1', delta: 'Native item tool result handled.' };
    yield {
      type: 'item_completed',
      item: { id: 'agent_native_1', kind: 'agent_message', content: 'Native item tool result handled.', status: 'completed' },
    };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class PlanDeltaOnlyModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'plan_delta', itemId: 'plan_item_1', text: '1. Inspect current files.\n' };
    yield { type: 'plan_delta', itemId: 'plan_item_1', text: '2. Wait for confirmation before edits.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class PlanThenToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { type: 'plan_delta', itemId: 'plan_item_1', text: '1. Inspect current files.\n' };
      yield { type: 'plan_delta', itemId: 'plan_item_1', text: '2. Run the read tool after confirmation.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_after_plan', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Executed the accepted plan.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class MailboxAwareModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'Mailbox handled.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class CollaborationToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.messages.some((message) => message.content.includes('<mailbox_message'))) {
      yield { type: 'text_delta', text: 'Child resumed with mailbox.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (request.messages.some((message) => message.role === 'user' && message.content === 'Inspect auth as child')) {
      yield { type: 'text_delta', text: 'Child initial result.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }

    const childThreadId = childThreadIdFromCollaborationToolMessages(request.messages);
    if (!childThreadId) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_spawn_agent', name: 'spawn_agent', arguments: '{"prompt":"Inspect auth as child","title":"Auth child"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (!hasToolMessage(request.messages, 'send_input')) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_send_input', name: 'send_input', arguments: JSON.stringify({ thread_id: childThreadId, content: 'queued clue' }) }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (!hasToolMessage(request.messages, 'resume_agent')) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_resume_agent', name: 'resume_agent', arguments: JSON.stringify({ thread_id: childThreadId, content: 'resume with queued clue' }) }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (!hasToolMessage(request.messages, 'wait')) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_wait', name: 'wait', arguments: JSON.stringify({ thread_id: childThreadId }) }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (!hasToolMessage(request.messages, 'close_agent')) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_close_agent', name: 'close_agent', arguments: JSON.stringify({ thread_id: childThreadId, reason: 'done' }) }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Parent completed collaboration.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class StepSnapshotModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_step_1', name: 'step_tool_1', arguments: '{}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Fresh step captured.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class SingleToolCallModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(private readonly toolCall: RuntimeToolCall) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [this.toolCall],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'tool handled' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class StopHookModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: this.requests.length === 1 ? 'first answer' : 'final answer' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ShellOutputDeltaModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_shell', name: 'run_shell_command', arguments: '{"command":"echo streamed","risk_level":"low"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'saw output' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ParallelReadModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [
          { id: 'call_read', name: 'read_file', arguments: '{"file_path":"README.md"}' },
          { id: 'call_search', name: 'search_text', arguments: '{"query":"needle"}' },
        ],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'parallel results received' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class DeferredToolSearchModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_tool_search', name: 'tool_search', arguments: '{"query":"lookup"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_deferred_lookup', name: 'deferred_lookup', arguments: '{"id":"alpha"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'deferred lookup complete' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ToolSuggestThenSearchModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_tool_suggest', name: 'tool_suggest', arguments: '{"query":"lookup","limit":1}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_tool_search_after_suggest', name: 'tool_search', arguments: '{"query":"lookup","limit":1}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 3) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_suggested_deferred_lookup', name: 'deferred_lookup', arguments: '{"id":"alpha"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'suggested deferred lookup complete' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class UnadvertisedDeferredToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_unadvertised_deferred_lookup', name: 'deferred_lookup', arguments: '{"id":"alpha"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'handled unadvertised tool rejection' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ExactDeferredToolSearchModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exact_tool_search',
          name: 'tool_search',
          arguments: '{"query":"search_graph graph search projects","limit":1}',
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'exact deferred search complete' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class OverlargeInspectionModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: Array.from({ length: 10 }, (_, index) => ({
          id: `call_${index + 1}`,
          name: 'read_file',
          arguments: JSON.stringify({ file_path: `src/file-${index + 1}.ts` }),
        })),
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'summarized after first batch' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ForcedToolChoiceModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'forced choice observed' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ToolDeltaModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { type: 'tool_call_delta', call: { id: 'call_delta', name: 'write_file', argumentsDelta: '{"file_path":"src/generated.txt",' } };
      yield { type: 'tool_call_delta', call: { id: 'call_delta', name: 'write_file', argumentsDelta: '"content":"generated\\n"}' } };
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_delta', name: 'write_file', arguments: '{"file_path":"src/generated.txt","content":"generated\\n"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'done' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class UnadvertisedDeferredToolDeltaModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'tool_call_delta', call: { id: 'call_hidden_delta', name: 'deferred_lookup', argumentsDelta: '{"id":"alpha"}' } };
    yield { type: 'text_delta', text: 'handled hidden delta without preview' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RepeatedFileWriteModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length <= 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: `call_repeated_write_${this.requests.length}`, name: 'write_file', arguments: '{"file_path":"src/generated.txt","content":"generated\\n"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'done' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ProtectedMetadataWriteModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_protected_write', name: 'write_file', arguments: '{"file_path":".git/config","content":"unsafe\\n"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'blocked' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ShellApplyPatchModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(
    private readonly filePath: string,
    private readonly commandPrefix = '',
    private readonly commandName = 'apply_patch',
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_shell_patch',
          name: 'run_shell_command',
          arguments: JSON.stringify({
            command: shellApplyPatchCommand(this.filePath, this.commandPrefix, this.commandName),
            risk_level: 'low',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'shell patch handled' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ShellMentionApplyPatchModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_shell_search',
          name: 'run_shell_command',
          arguments: JSON.stringify({
            command: 'rg apply_patch',
            risk_level: 'low',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'search handled' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ToolLoopLimitModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.toolChoice === 'none' || !request.tools?.length) {
      yield { type: 'text_delta', text: 'Final answer after the available tool results.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield {
      type: 'tool_calls',
      toolCalls: [{ id: `call_${this.requests.length}`, name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
    };
    yield { type: 'done', finishReason: 'tool_calls' };
  }
}

class ContextCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield {
      type: 'text_delta',
      text: JSON.stringify({
        summary: '模型整理后的上下文摘要',
        important_constraints: ['只保留关键历史'],
        open_items: ['继续当前任务'],
        already_said: '已说明实现方向',
        tool_context: '没有额外工具上下文',
      }),
    };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class BlockingContextCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private markStarted: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    this.markStarted();
    await new Promise<void>((resolve) => {
      if (!request.signal) {
        resolve();
        return;
      }
      if (request.signal.aborted) {
        resolve();
        return;
      }
      request.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    request.signal?.throwIfAborted();
    yield { type: 'text_delta', text: 'should not finish' };
  }
}

class AutoCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'context-compaction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          summary: 'Automatic summary for oversized history.',
          important_constraints: ['Keep the current task.'],
          open_items: ['Continue the turn.'],
          already_said: 'Older history was summarized.',
          tool_context: 'No active tool context.',
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Final answer after automatic compaction.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RemoteCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  compactRequests: ModelCompactionRequest[] = [];

  async compactConversation(request: ModelCompactionRequest) {
    this.compactRequests.push(request);
    return {
      summary: JSON.stringify({
        summary: 'Remote provider compacted the older history.',
        important_constraints: ['Preserve the latest user request.'],
        open_items: ['Continue after remote compaction.'],
        already_said: 'Older context was compacted by the provider-native path.',
        tool_context: 'No active tool context.',
      }),
      usage: {
        provider: 'openai-responses',
        model: 'gpt-compact',
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      },
    };
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'Final answer after remote compaction.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class MidTurnToolCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'context-compaction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          summary: 'Summarized oversized tool output.',
          important_constraints: ['Keep the user request and tool-call intent.'],
          open_items: ['Continue after the tool result.'],
          already_said: 'The raw tool output was too large for the active context window.',
          tool_context: 'The read_file result was summarized instead of replayed verbatim.',
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.filter((item) => item.model === 'local-runtime-smoke').length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_huge_tool', name: 'workspace_read_file', arguments: '{"path":"huge-report.txt"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Final answer after summarized tool result.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

const WORKSPACE_READ_FILE_TOOL: RuntimeToolDefinition = {
  name: 'workspace_read_file',
  description: 'Read a file',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

const RUN_SHELL_COMMAND_TOOL: RuntimeToolDefinition = {
  name: 'run_shell_command',
  description: 'Run a shell command',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      risk_level: { type: 'string' },
      directory: { type: 'string' },
    },
    required: ['command'],
  },
};

const APPLY_PATCH_TOOL: RuntimeToolDefinition = {
  name: 'apply_patch',
  description: 'Apply a workspace patch',
  inputSchema: {
    type: 'object',
    properties: {
      patch: { type: 'string' },
      workdir: { type: 'string' },
    },
    required: ['patch'],
  },
};

class CapturingToolHost implements ToolHost {
  calls: Array<{ name: string; input: unknown; projectId?: string }> = [];
  cleanupCalls: Array<{ threadId: string; projectId?: string; turnId?: string; status: ToolTurnCleanupOutcome['status'] }> = [];

  constructor(private readonly tools: RuntimeToolDefinition[] = [WORKSPACE_READ_FILE_TOOL]) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return this.tools;
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    this.calls.push({ name, input, projectId: context.projectId });
    return { content: 'file contents from tool' };
  }

  cleanupTurn(context: ToolExecutionContext, outcome: ToolTurnCleanupOutcome) {
    this.cleanupCalls.push({
      threadId: context.threadId,
      projectId: context.projectId,
      turnId: context.turnId,
      status: outcome.status,
    });
  }
}

class RefreshingToolHost implements ToolHost {
  listCalls = 0;
  environmentCalls = 0;
  runContexts: ToolExecutionContext[] = [];

  environmentForToolContext(_context: ToolExecutionContext) {
    this.environmentCalls += 1;
    return {
      id: `step_env_${this.environmentCalls}`,
      cwd: `/tmp/setsuna-step-${this.environmentCalls}`,
    };
  }

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    this.listCalls += 1;
    if (!context.environment) throw new Error('Expected listTools to receive the step environment.');
    return [
      {
        name: `step_tool_${this.listCalls}`,
        description: 'Tool that changes between sampling steps',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
    ];
  }

  async runTool(name: string, _input: unknown, context: ToolExecutionContext) {
    this.runContexts.push(context);
    return { content: `${name} result from current step` };
  }
}

class LargeToolResultHost extends CapturingToolHost {
  readonly largeContent = 'BEGIN_HUGE_TOOL_OUTPUT ' + 'huge generated report '.repeat(90_000);

  override async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    this.calls.push({ name, input, projectId: context.projectId });
    return { content: this.largeContent };
  }
}

class ExternalContextToolHost implements ToolHost {
  constructor(
    private readonly toolName = 'mcp__search__fetch',
    private readonly containsExternalContext = false,
  ) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: this.toolName,
        description: 'Fetch external search context',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ];
  }

  async runTool() {
    return { content: 'external search result', containsExternalContext: this.containsExternalContext };
  }
}

class BlockingToolHost implements ToolHost {
  calls: Array<{ name: string; input: unknown; projectId?: string }> = [];
  private markStarted: () => void = () => undefined;
  private releaseTool: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  private readonly released = new Promise<void>((resolve) => {
    this.releaseTool = resolve;
  });

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'workspace_read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ];
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    this.calls.push({ name, input, projectId: context.projectId });
    this.markStarted();
    await this.released;
    return { content: 'file contents from blocked tool' };
  }

  release(): void {
    this.releaseTool();
  }
}

class BlockingUserShellHost implements ToolHost {
  calls: Array<{ command: string; projectId?: string; turnId?: string }> = [];
  private markStarted: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'run_shell_command',
        description: 'Run a shell command',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    ];
  }

  async runTool(_name: string, input: unknown, context: ToolExecutionContext) {
    const command = input && typeof input === 'object' && !Array.isArray(input) && typeof (input as { command?: unknown }).command === 'string'
      ? (input as { command: string }).command
      : '';
    this.calls.push({ command, projectId: context.projectId, turnId: context.turnId });
    this.markStarted();
    await new Promise<void>((resolve) => {
      if (!context.signal) {
        resolve();
        return;
      }
      if (context.signal.aborted) {
        resolve();
        return;
      }
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    context.signal?.throwIfAborted();
    return { content: 'user shell finished' };
  }
}

class NonWaitingCancellationToolHost implements ToolHost {
  private markStarted: () => void = () => undefined;
  private releaseTool: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  readonly done = new Promise<void>((resolve) => {
    this.releaseTool = resolve;
  });

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'background_tool',
        description: 'A runtime-managed background tool',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
    ];
  }

  toolRuntimeProfile(_name: string, _context: ToolExecutionContext): ToolRuntimeProfile {
    return { waitsForRuntimeCancellation: false };
  }

  async runTool() {
    this.markStarted();
    await this.done;
    return { content: 'background tool finished' };
  }

  release(): void {
    this.releaseTool();
  }
}

class DelayedSteerAppendThreadStore implements ThreadStore {
  private markStarted: () => void = () => undefined;
  private releaseAppend: () => void = () => undefined;
  readonly steerAppendStarted = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  private readonly appendReleased = new Promise<void>((resolve) => {
    this.releaseAppend = resolve;
  });

  constructor(
    private readonly inner: ThreadStore,
    private readonly delayedClientId: string,
  ) {}

  listThreads(query?: ThreadQuery): Promise<RuntimeThreadSummary[]> {
    return this.inner.listThreads(query);
  }

  getThread(threadId: string): Promise<RuntimeThread | null> {
    return this.inner.getThread(threadId);
  }

  createThread(input?: CreateThreadInput): Promise<RuntimeThread> {
    return this.inner.createThread(input);
  }

  deleteThread(threadId: string): Promise<void> {
    return this.inner.deleteThread(threadId);
  }

  updateThread(threadId: string, patch: ThreadPatch): Promise<RuntimeThread> {
    return this.inner.updateThread(threadId, patch);
  }

  updateThreadMemoryMode(threadId: string, mode: NonNullable<RuntimeThread['memoryMode']>, reason?: string): Promise<RuntimeThread> {
    return this.inner.updateThreadMemoryMode(threadId, mode, reason);
  }

  updateMessage(threadId: string, messageId: string, patch: MessagePatch): Promise<RuntimeThread> {
    return this.inner.updateMessage(threadId, messageId, patch);
  }

  deleteMessages(threadId: string, input: MessageDeleteInput): Promise<RuntimeThread> {
    return this.inner.deleteMessages(threadId, input);
  }

  truncateMessagesAfter(threadId: string, messageId: string, includeSelf?: boolean): Promise<RuntimeThread> {
    return this.inner.truncateMessagesAfter(threadId, messageId, includeSelf);
  }

  clearThreadMessages(threadId: string): Promise<RuntimeThread> {
    return this.inner.clearThreadMessages(threadId);
  }

  async appendEvent(threadId: string, event: Omit<RuntimeEvent, 'seq'>): Promise<RuntimeEvent> {
    const payload = event.payload as { message?: { clientId?: string } };
    if (event.type === 'message.created' && payload.message?.clientId === this.delayedClientId) {
      this.markStarted();
      await this.appendReleased;
    }
    return this.inner.appendEvent(threadId, event);
  }

  listEvents(threadId: string, sinceSeq?: number): Promise<RuntimeEvent[]> {
    return this.inner.listEvents(threadId, sinceSeq);
  }

  releaseSteerAppend(): void {
    this.releaseAppend();
  }
}

class OutputDeltaToolHost implements ToolHost {
  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'run_shell_command',
        description: 'Run a command',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' }, risk_level: { type: 'string' } },
          required: ['command', 'risk_level'],
        },
      },
    ];
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    context.onToolOutputDelta?.({
      delta: 'streamed output\n',
      stream: 'stdout',
      processId: 'shell_test',
    });
    return {
      content: 'command completed',
      data: { process_id: 'shell_test', command: 'echo streamed', exit_code: 0 },
    };
  }
}

class ParallelReadToolHost implements ToolHost {
  readonly started: string[] = [];
  readonly contexts: ToolExecutionContext[] = [];
  private readonly blocker: Promise<void>;
  private releaseBlocker: () => void = () => undefined;

  constructor() {
    this.blocker = new Promise<void>((resolve) => {
      this.releaseBlocker = resolve;
    });
  }

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
      {
        name: 'search_text',
        description: 'Search text',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ];
  }

  async runTool(name: string, _input: unknown, context: ToolExecutionContext) {
    this.started.push(name);
    this.contexts.push(context);
    await this.blocker;
    return { content: `${name} result` };
  }

  releaseAll(): void {
    this.releaseBlocker();
  }
}

class SerialProfileReadToolHost extends ParallelReadToolHost {
  toolRuntimeProfile(_name: string, _context: ToolExecutionContext): ToolRuntimeProfile {
    return { supportsParallel: false };
  }
}

class DeferredToolHost implements ToolHost {
  calls: Array<{ name: string; input: unknown; projectId?: string }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'direct_tool',
        description: 'A directly visible tool',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
      {
        name: 'deferred_lookup',
        description: 'Lookup hidden project facts after discovery',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
    ];
  }

  toolRuntimeProfile(name: string, _context: ToolExecutionContext): ToolRuntimeProfile {
    return name === 'deferred_lookup' ? { exposure: 'deferred' } : { exposure: 'direct' };
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    this.calls.push({ name, input, projectId: context.projectId });
    return { content: `${name} result` };
  }
}

class ToolSearchCollisionHost extends DeferredToolHost {
  override async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'tool_search',
        description: 'Host-provided tool search that must not shadow runtime discovery',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      ...(await super.listTools(context)),
    ];
  }

  override async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    if (name === 'tool_search') throw new Error('Host tool_search should not be executed.');
    return super.runTool(name, input, context);
  }
}

class ManyDeferredToolHost implements ToolHost {
  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'direct_tool',
        description: 'A directly visible tool',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
      {
        name: 'graph_search_history',
        description: 'Search graph history and projects with many overlapping graph search terms',
        inputSchema: {
          type: 'object',
          properties: { project: { type: 'string' } },
        },
      },
      {
        name: 'search_projects',
        description: 'Search projects and graph indexes',
        inputSchema: {
          type: 'object',
          properties: { graph: { type: 'string' } },
        },
      },
      {
        name: 'search_graph',
        description: 'Exact graph search tool',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ];
  }

  toolRuntimeProfile(name: string, _context: ToolExecutionContext): ToolRuntimeProfile {
    return name === 'direct_tool' ? { exposure: 'direct' } : { exposure: 'deferred' };
  }

  async runTool() {
    return { content: 'unused' };
  }
}

class CountingReadToolHost implements ToolHost {
  readonly calls: Array<{ file_path?: unknown }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
    ];
  }

  async runTool(_name: string, input: unknown) {
    const parsed = input && typeof input === 'object' && !Array.isArray(input) ? input as { file_path?: unknown } : {};
    this.calls.push(parsed);
    return { content: `contents for ${String(parsed.file_path ?? 'unknown')}` };
  }
}

class ForcedToolChoiceHost implements ToolHost {
  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'write_file',
        description: 'Write a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' }, content: { type: 'string' } },
          required: ['file_path', 'content'],
        },
      },
    ];
  }

  toolChoice() {
    return { type: 'tool' as const, name: 'write_file' };
  }

  async runTool() {
    return { content: 'unused' };
  }
}

class PreviewingToolHost implements ToolHost {
  calls = 0;
  partialPreviewCalls: Array<{ name: string; hasProjectId: boolean }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'write_file',
        description: 'Write a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' }, content: { type: 'string' } },
          required: ['file_path', 'content'],
        },
      },
    ];
  }

  systemPrompt() {
    return 'PC local tool prompt';
  }

  async previewPartialToolCall(name: string, rawArguments: string, context: ToolExecutionContext) {
    this.partialPreviewCalls.push({ name, hasProjectId: Boolean(context.projectId) });
    if (!rawArguments.includes('src/generated.txt')) return null;
    return filePreview();
  }

  async previewToolCall() {
    return filePreview();
  }

  async runTool() {
    this.calls += 1;
    return { content: 'wrote file', preview: filePreview().resultPreview };
  }
}

class DeferredPreviewingToolHost extends DeferredToolHost {
  partialPreviewCalls: Array<{ name: string; rawArguments: string }> = [];

  async previewPartialToolCall(name: string, rawArguments: string) {
    this.partialPreviewCalls.push({ name, rawArguments });
    return {
      argumentsPreview: rawArguments,
      resultPreview: `preview for ${name}`,
    };
  }
}

class ShellApplyPatchInterceptHost implements ToolHost {
  calls: Array<{ name: string; input: unknown }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'run_shell_command',
        description: 'Run a shell command',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' }, risk_level: { type: 'string' } },
          required: ['command', 'risk_level'],
        },
      },
      {
        name: 'apply_patch',
        description: 'Apply a patch',
        inputSchema: {
          type: 'object',
          properties: { patch: { type: 'string' } },
          required: ['patch'],
        },
      },
    ];
  }

  async previewToolCall(name: string, input: unknown) {
    if (name !== 'apply_patch') return null;
    return shellPatchPreview(input);
  }

  async runTool(name: string, input: unknown) {
    this.calls.push({ name, input });
    return { content: 'applied intercepted patch', preview: shellPatchPreview(input).resultPreview };
  }
}

function filePreview() {
  return {
    argumentsPreview: JSON.stringify({ file_path: 'src/generated.txt' }),
    resultPreview: JSON.stringify({
      diff: {
        path: 'src/generated.txt',
        action: 'create',
        additions: 1,
        deletions: 0,
        truncated: false,
        lines: [{ type: 'added', content: 'generated', newLine: 1 }],
      },
    }),
  };
}

function shellPatchPreview(input: unknown) {
  const patch = input && typeof input === 'object' && !Array.isArray(input) && typeof (input as { patch?: unknown }).patch === 'string'
    ? (input as { patch: string }).patch
    : '';
  const filePath = /(?:\*\*\* Add File: |\*\*\* Update File: |\*\*\* Delete File: )(.+)/.exec(patch)?.[1]?.trim() || 'src/from-shell.txt';
  return {
    argumentsPreview: JSON.stringify({ patch }),
    resultPreview: JSON.stringify({
      diff: {
        path: filePath,
        action: 'Created',
        additions: 1,
        deletions: 0,
        truncated: false,
        lines: [{ type: 'added', content: 'shell', newLine: 1 }],
      },
    }),
  };
}

function shellApplyPatchCommand(filePath: string, prefix = '', commandName = 'apply_patch'): string {
  return [
    `${prefix}${commandName} <<'PATCH'`,
    '*** Begin Patch',
    `*** Add File: ${filePath}`,
    '+shell',
    '*** End Patch',
    'PATCH',
  ].join('\n');
}

class MemoryCapturingModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'Remembered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class MemoryCitationModelClient implements ModelClient {
  async *stream(_request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    yield { type: 'text_delta', text: 'Answer <oai-mem-' };
    yield {
      type: 'text_delta',
      text: [
        'citation>',
        '<citation_entries>',
        'MEMORY.md:1-2|note=[summary]',
        '</citation_entries>',
        '<rollout_ids>',
        'thread_a',
        'thread_b',
        'thread_a',
        '</rollout_ids>',
        '</oai-mem-',
      ].join('\n'),
    };
    yield { type: 'text_delta', text: 'citation> done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RememberMemoryToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [
          {
            id: 'call_memory',
            name: 'remember_memory',
            arguments: JSON.stringify({ content: '这个项目用 pnpm 管理依赖。', scope: 'project' }),
          },
        ],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Saved.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class PassiveMemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction' || request.model === 'memory-extract-model') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          memories: [
            {
              content: '用户要求记忆生成模型要跟随当前切换的模型。',
              title: '记忆模型',
              scope: 'project',
              tags: ['memory', 'model'],
            },
          ],
        }),
      };
      yield {
        type: 'usage',
        usage: {
          provider: 'test-provider',
          model: 'selected-model',
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
        },
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class CodexStage1MemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          raw_memory: '## Durable Preference\nUser wants passive memory extraction to follow the currently selected model.',
          rollout_summary: 'User prefers passive memory extraction to follow the selected model.',
          rollout_slug: 'memory-model-routing',
          memories: [
            {
              content: '用户要求记忆生成模型要跟随当前切换的模型。',
              title: '记忆模型',
              scope: 'project',
              kind: 'preference',
              tags: ['memory', 'model'],
            },
          ],
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ConsolidatingCodexMemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private consolidationRounds = 0;

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          raw_memory: '## Durable Preference\nUser wants passive memory extraction to follow the currently selected model.',
          rollout_summary: 'User prefers passive memory extraction to follow the selected model.',
          rollout_slug: 'memory-model-routing',
          memories: [
            {
              content: '用户要求记忆生成模型要跟随当前切换的模型。',
              title: '记忆模型',
              scope: 'project',
              kind: 'preference',
              tags: ['memory', 'model'],
            },
          ],
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (request.model === 'memory-consolidation') {
      this.consolidationRounds += 1;
      if (this.consolidationRounds === 1) {
        yield {
          type: 'tool_calls',
          toolCalls: [
            { id: 'phase2_read_diff', name: 'read_file', arguments: JSON.stringify({ path: 'phase2_workspace_diff.md' }) },
            {
              id: 'phase2_write_memory',
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'MEMORY.md',
                content: [
                  '# Task Group: Memory model routing',
                  'scope: passive memory extraction model routing in the desktop runtime',
                  'applies_to: cwd=/Users/zy/Documents/setsuna-desktop; reuse_rule=use for memory extraction alignment work',
                  '',
                  '## Task 1: Align passive memory extraction with the selected model',
                  '',
                  '### rollout_summary_files',
                  '',
                  '- rollout_summaries/2026-01-01T00-00-00-demo-memory_model_routing.md (cwd=/Users/zy/Documents/setsuna-desktop, rollout_path=memory, updated_at=2026-01-01T00:00:00.000Z, thread_id=thread)',
                  '',
                  '### keywords',
                  '',
                  '- passive-memory-extraction, memory-consolidation, selected model',
                  '',
                  '## User preferences',
                  '',
                  '- when memory extraction model routing is in scope, preserve the selected-model behavior. [Task 1]',
                  '',
                  '## Reusable knowledge',
                  '',
                  '- Stage-1 output uses raw_memory, rollout_summary, and rollout_slug before phase-2 consolidation. [Task 1]',
                  '',
                ].join('\n'),
              }),
            },
            {
              id: 'phase2_write_summary',
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'memory_summary.md',
                content: [
                  'v1',
                  '',
                  '## User Profile',
                  '',
                  'The user works on Setsuna Desktop memory alignment.',
                  '',
                  '## User preferences',
                  '',
                  '- Preserve selected-model behavior for passive memory extraction work.',
                  '',
                  '## General Tips',
                  '',
                  '- Search MEMORY.md for passive-memory-extraction when memory routing is relevant.',
                  '',
                  "## What's in Memory",
                  '',
                  '### /Users/zy/Documents/setsuna-desktop',
                  '',
                  '#### 2026-01-01',
                  '',
                  '- Memory model routing: keywords=passive-memory-extraction, memory-consolidation; stage-1 to phase-2 alignment notes.',
                  '',
                ].join('\n'),
              }),
            },
          ],
        };
        yield { type: 'done', finishReason: 'tool_calls' };
        return;
      }
      yield { type: 'text_delta', text: 'Consolidation complete.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class NoOutputStage1MemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          raw_memory: '',
          rollout_summary: '',
          rollout_slug: '',
          memories: [],
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ExternalContextMemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(private readonly toolName = 'mcp__search__fetch') {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          memories: [{ content: '这条外部搜索结果不应该被长期记忆。', scope: 'global' }],
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_external', name: this.toolName, arguments: '{"query":"setsuna"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Used external context.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ActiveMemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          memories: [
            {
              content: '用户偏好当前仓库样式尽量使用 UnoCSS。',
              title: '仓库样式',
              scope: 'project',
            },
          ],
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [
          {
            id: 'call_memory',
            name: 'remember_memory',
            arguments: JSON.stringify({
              content: '当前仓库的样式需要尽可能使用 UnoCSS。',
              scope: 'project',
            }),
          },
        ],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: '已记录到项目级记忆中。' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RegenerateModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: `answer ${this.requests.length}` };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ReasoningModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'reasoning_delta', text: 'plan' };
    yield { type: 'text_delta', text: 'answer' };
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ApprovalToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_approval', name: 'dangerous_tool', arguments: '{"value":42}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The approved tool ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class EscalatedExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_escalated',
          name: 'exec_command',
          arguments: '{"cmd":"printf ok","sandbox_permissions":"require_escalated","justification":"needs unsandboxed access"}',
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The escalated command ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RepeatedEscalatedPrefixExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_prefix_first',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'git status',
            sandbox_permissions: 'require_escalated',
            justification: 'needs unsandboxed git access',
            prefix_rule: ['git', 'status'],
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_prefix_second',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'git status --short',
            sandbox_permissions: 'require_escalated',
            justification: 'same approved prefix',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The prefix-approved commands ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class BroadEscalatedPrefixExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_broad_prefix_first',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'git status',
            sandbox_permissions: 'require_escalated',
            justification: 'needs broad git access',
            prefix_rule: ['git'],
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_broad_prefix_second',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'git push',
            sandbox_permissions: 'require_escalated',
            justification: 'another broad git command',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The broad-prefix commands ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RepeatedAdditionalPermissionsExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(private readonly writableRoot: string) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1 || this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: `call_exec_additional_${this.requests.length}`,
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'curl https://api.example.com/a',
            sandbox_permissions: 'with_additional_permissions',
            additional_permissions: {
              network: { enabled: true },
              file_system: { write: [this.writableRoot] },
            },
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The additional-permissions command ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RequestPermissionsThenExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(
    private readonly grantedRoot: string,
    private readonly denyOptions?: { deniedRoot?: string; deniedSpecialRoot?: string; deniedGlobPattern?: string },
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_request_permissions_turn',
          name: 'request_permissions',
          arguments: JSON.stringify({
            reason: 'Allow reading and writing an external temp directory plus network access.',
            permissions: {
              network: { enabled: true },
              file_system: {
                read: [this.grantedRoot],
                write: [this.grantedRoot],
                entries: [
                  ...(this.denyOptions?.deniedRoot ? [{
                    path: { type: 'path', path: this.denyOptions.deniedRoot },
                    access: 'deny',
                  }] : []),
                  ...(this.denyOptions?.deniedSpecialRoot ? [{
                    path: { type: 'special', value: { kind: 'project_roots', subpath: this.denyOptions.deniedSpecialRoot } },
                    access: 'deny',
                  }] : []),
                  ...(this.denyOptions?.deniedGlobPattern ? [{
                    path: { type: 'glob_pattern', pattern: this.denyOptions.deniedGlobPattern },
                    access: 'deny',
                  }] : []),
                ],
              },
            },
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_after_request_permissions',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: `printf ok > ${this.grantedRoot}/allowed.txt`,
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The request_permissions grant was used.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class SessionRequestPermissionsModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(private readonly grantedRoot: string) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_request_permissions_session',
          name: 'request_permissions',
          arguments: JSON.stringify({
            reason: 'Allow reusing an external temp directory across turns.',
            permissions: {
              file_system: {
                entries: [{
                  path: { type: 'path', path: this.grantedRoot },
                  access: 'write',
                }],
              },
            },
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield { type: 'text_delta', text: 'Session permission recorded.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 3) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_after_session_request_permissions',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: `printf ok > ${this.grantedRoot}/session.txt`,
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The session grant was reused.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ProtectedAdditionalPermissionsExecModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_exec_protected_additional',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'printf unsafe',
            sandbox_permissions: 'with_additional_permissions',
            additional_permissions: {
              file_system: { write: ['.git'] },
            },
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The unsafe command was rejected.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class SandboxDeniedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_sandboxed', name: 'sandboxed_tool', arguments: '{"value":42}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The sandboxed tool recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RepeatedSandboxDeniedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1 || this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: `call_sandboxed_${this.requests.length}`, name: 'sandboxed_tool', arguments: '{"value":42}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The repeated sandboxed tool recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class NetworkDeniedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_network', name: 'network_tool', arguments: '{"value":42}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The network tool recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RepeatedNetworkDeniedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1 || this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: `call_network_${this.requests.length}`, name: 'network_tool', arguments: '{"value":42}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The repeated network tool recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class EscalatedNetworkDeniedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_escalated_network',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'curl https://api.example.com/a',
            sandbox_permissions: 'require_escalated',
            justification: 'needs unsandboxed network access',
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The escalated network command recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RepeatedHostNetworkShellModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_network_a', name: 'run_shell_command', arguments: '{"command":"curl https://api.example.com/a","risk_level":"low"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_network_b', name: 'run_shell_command', arguments: '{"command":"curl https://api.example.com/b","risk_level":"low"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The repeated host network commands recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class CancellableModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  aborted = false;
  private abortListenerReadyResolve: () => void = () => undefined;
  private readonly abortListenerReady = new Promise<void>((resolve) => {
    this.abortListenerReadyResolve = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    const abortWait = new Promise<void>((resolve) => {
      const signal = request.signal;
      if (!signal) {
        this.abortListenerReadyResolve();
        resolve();
        return;
      }
      if (signal.aborted) {
        this.aborted = true;
        this.abortListenerReadyResolve();
        resolve();
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          this.aborted = true;
          resolve();
        },
        { once: true },
      );
      this.abortListenerReadyResolve();
    });
    yield { type: 'text_delta', text: 'partial response' };
    await abortWait;
    request.signal?.throwIfAborted();
    yield { type: 'text_delta', text: ' should not appear' };
    yield { type: 'done', finishReason: 'stop' };
  }

  async waitUntilAbortListenerReady(): Promise<void> {
    await this.abortListenerReady;
  }
}

class NonCooperativeCancellationModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  aborted = false;
  private abortListenerReadyResolve: () => void = () => undefined;
  private readonly abortListenerReady = new Promise<void>((resolve) => {
    this.abortListenerReadyResolve = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    request.signal?.addEventListener('abort', () => {
      this.aborted = true;
    }, { once: true });
    this.abortListenerReadyResolve();
    yield { type: 'text_delta', text: 'partial response' };
    await new Promise<never>(() => undefined);
  }

  async waitUntilAbortListenerReady(): Promise<void> {
    await this.abortListenerReady;
  }
}

class SteerableModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private releaseFirst: () => void = () => undefined;
  private readonly firstResponseReleased = new Promise<void>((resolve) => {
    this.releaseFirst = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { type: 'text_delta', text: 'initial answer' };
      await this.firstResponseReleased;
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'guided answer' };
    yield { type: 'done', finishReason: 'stop' };
  }

  releaseFirstResponse(): void {
    this.releaseFirst();
  }
}

class OversizedSteerCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private releaseFirst: () => void = () => undefined;
  private readonly firstResponseReleased = new Promise<void>((resolve) => {
    this.releaseFirst = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'context-compaction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          summary: 'Summarized oversized steer input.',
          important_constraints: ['Preserve the user steer intent.'],
          open_items: ['Continue after applying the steer.'],
          already_said: 'The active user steer was too large for the active context window.',
          tool_context: 'No tool output was involved.',
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    const localRequestCount = this.requests.filter((item) => item.model === 'local-runtime-smoke').length;
    if (localRequestCount === 1) {
      yield { type: 'text_delta', text: 'initial answer' };
      await this.firstResponseReleased;
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'guided answer after oversized steer summary' };
    yield { type: 'done', finishReason: 'stop' };
  }

  releaseFirstResponse(): void {
    this.releaseFirst();
  }
}

class ApprovalToolHost implements ToolHost {
  calls: Array<{ name: string; input: unknown }> = [];

  constructor(private readonly options: { approvalKeys?: string[]; persistentApprovalKeys?: string[] } = {}) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'dangerous_tool',
        description: 'A tool requiring user approval',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      },
    ];
  }

  async approvalForTool(name: string, input: unknown) {
    return name === 'dangerous_tool'
      ? {
        reason: 'This tool changes local state.',
        argumentsPreview: JSON.stringify(input),
        approvalKeys: this.options.approvalKeys,
        persistentApprovalKeys: this.options.persistentApprovalKeys,
      }
      : null;
  }

  async runTool(name: string, input: unknown) {
    this.calls.push({ name, input });
    return { content: 'approved result' };
  }
}

class InMemoryPersistentToolApprovalStore implements PersistentToolApprovalStore {
  private readonly approvalKeys = new Set<string>();

  async hasAll(keys: string[]): Promise<boolean> {
    return keys.length > 0 && keys.every((key) => this.approvalKeys.has(key));
  }

  async approve(keys: string[]): Promise<void> {
    for (const key of keys) {
      if (key) this.approvalKeys.add(key);
    }
  }
}

class EscalatedExecToolHost implements ToolHost {
  attempts: string[] = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'exec_command',
        description: 'A Codex-compatible exec tool',
        inputSchema: { type: 'object', properties: { cmd: { type: 'string' } } },
      },
    ];
  }

  async approvalForTool(name: string, input: unknown) {
    const args = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
    return name === 'exec_command' && args.sandbox_permissions === 'require_escalated'
      ? {
          reason: String(args.justification || 'requires escalated sandbox permissions'),
          argumentsPreview: JSON.stringify(input),
        }
      : null;
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    this.attempts.push(context.sandbox?.mode ?? 'missing');
    return { content: 'ran escalated exec' };
  }
}

class AdditionalPermissionsExecToolHost implements ToolHost {
  contexts: ToolExecutionContext[] = [];

  constructor(private readonly cwd = process.cwd()) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'exec_command',
        description: 'A Codex-compatible exec tool',
        inputSchema: { type: 'object', properties: { cmd: { type: 'string' } } },
      },
    ];
  }

  environmentForToolContext(context: ToolExecutionContext) {
    return {
      id: context.projectId ?? context.threadId,
      cwd: this.cwd,
    };
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    this.contexts.push(context);
    return { content: 'ran with additional permissions' };
  }
}

class RequestPermissionsExecToolHost implements ToolHost {
  contexts: ToolExecutionContext[] = [];

  constructor(private readonly cwd = process.cwd()) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'request_permissions',
        description: 'A Codex-compatible permission request tool',
        inputSchema: { type: 'object', properties: { permissions: { type: 'object' } } },
      },
      {
        name: 'exec_command',
        description: 'A Codex-compatible exec tool',
        inputSchema: { type: 'object', properties: { cmd: { type: 'string' } } },
      },
    ];
  }

  environmentForToolContext(context: ToolExecutionContext) {
    return {
      id: context.projectId ?? context.threadId,
      cwd: this.cwd,
    };
  }

  async runTool(name: string, _input: unknown, context: ToolExecutionContext) {
    if (name === 'request_permissions') throw new Error('request_permissions should be handled by the orchestrator');
    this.contexts.push(context);
    return { content: 'ran after request_permissions' };
  }
}

class SandboxRetryToolHost implements ToolHost {
  attempts: string[] = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'sandboxed_tool',
        description: 'A tool that needs sandbox retry',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      },
    ];
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    this.attempts.push(context.sandbox?.mode ?? 'missing');
    if (context.sandbox?.mode !== 'bypass') {
      throw new ToolExecutionError('seatbelt denied file write', {
        failureKind: 'sandbox_denied',
        failureStage: 'execution',
      });
    }
    return { content: 'retried without sandbox' };
  }
}

class NetworkRetryToolHost implements ToolHost {
  attempts: string[] = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'network_tool',
        description: 'A tool that needs network retry',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      },
    ];
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    this.attempts.push(context.sandbox?.networkAccess ?? 'default');
    if (context.sandbox?.networkAccess !== 'enabled') {
      throw new ToolExecutionError('network access disabled', {
        failureKind: 'network_denied',
        failureStage: 'preflight',
      });
    }
    return { content: 'retried with network' };
  }
}

class EscalatedNetworkRetryToolHost implements ToolHost {
  attempts: Array<{ mode: string; networkAccess: string }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'exec_command',
        description: 'A Codex-compatible exec tool that needs network retry',
        inputSchema: { type: 'object', properties: { cmd: { type: 'string' } } },
      },
    ];
  }

  async approvalForTool(name: string, input: unknown) {
    const args = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
    return name === 'exec_command' && args.sandbox_permissions === 'require_escalated'
      ? {
          reason: String(args.justification || 'requires escalated sandbox permissions'),
          argumentsPreview: JSON.stringify(input),
        }
      : null;
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    this.attempts.push({
      mode: context.sandbox?.mode ?? 'missing',
      networkAccess: context.sandbox?.networkAccess ?? 'default',
    });
    if (context.sandbox?.networkAccess !== 'enabled') {
      throw new ToolExecutionError('network access disabled', {
        failureKind: 'network_denied',
        failureStage: 'preflight',
      });
    }
    return { content: 'retried escalated command with network' };
  }
}

class ShellNetworkRetryToolHost implements ToolHost {
  attempts: Array<{ command: string; networkAccess: string }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'run_shell_command',
        description: 'A shell tool that needs network retry',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
      },
    ];
  }

  async runTool(_name: string, input: unknown, context: ToolExecutionContext) {
    const command = input && typeof input === 'object' && !Array.isArray(input)
      ? String((input as Record<string, unknown>).command || '')
      : '';
    this.attempts.push({ command, networkAccess: context.sandbox?.networkAccess ?? 'default' });
    if (context.sandbox?.networkAccess !== 'enabled') {
      throw new ToolExecutionError('network access disabled', {
        failureKind: 'network_denied',
        failureStage: 'preflight',
      });
    }
    return { content: `retried with network: ${command}` };
  }
}

class PolicyAwareShellNetworkRetryToolHost extends ShellNetworkRetryToolHost {
  constructor(private readonly policyAmendmentStore: PolicyAmendmentStore) {
    super();
  }

  override async runTool(_name: string, input: unknown, context: ToolExecutionContext) {
    const command = input && typeof input === 'object' && !Array.isArray(input)
      ? String((input as Record<string, unknown>).command || '')
      : '';
    this.attempts.push({ command, networkAccess: context.sandbox?.networkAccess ?? 'default' });
    if (context.sandbox?.networkAccess === 'enabled') return { content: `retried with network: ${command}` };
    const networkContext = {
      host: 'api.example.com',
      protocol: 'https',
      port: 443,
      target: 'https://api.example.com:443',
    };
    const amendments = await this.policyAmendmentStore.listPolicyAmendments();
    if (amendments.networkPolicyAmendments.some((item) => item.host === networkContext.host && item.action === 'deny')) {
      throw new ToolExecutionError('blocked by persistent network policy', {
        failureKind: 'network_denied',
        failureStage: 'preflight',
        data: {
          network_policy_decision: 'deny',
          network_approval_context: networkContext,
        },
      });
    }
    throw new ToolExecutionError('network access disabled', {
      failureKind: 'network_denied',
      failureStage: 'preflight',
      data: {
        network_approval_context: networkContext,
      },
    });
  }
}

class CapturingUsageStore implements UsageStore {
  records: RuntimeUsageRecord[] = [];

  async recordUsage(input: Omit<RuntimeUsageRecord, 'id'>): Promise<RuntimeUsageRecord> {
    const record = { id: `usage_${this.records.length + 1}`, ...input };
    this.records.push(record);
    return record;
  }

  async getUsage() {
    return {
      records: this.records,
      summary: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        recordCount: this.records.length,
        byProvider: [],
        byModel: [],
      },
    };
  }
}

class InMemoryPolicyAmendmentStore implements PolicyAmendmentStore {
  private readonly amendments: RuntimePolicyAmendments = {
    execPolicyAmendments: [],
    networkPolicyAmendments: [],
  };

  async listPolicyAmendments(): Promise<RuntimePolicyAmendments> {
    return {
      execPolicyAmendments: this.amendments.execPolicyAmendments.map((item) => [...item]),
      networkPolicyAmendments: this.amendments.networkPolicyAmendments.map((item) => ({ ...item })),
    };
  }

  async appendExecPolicyAmendment(amendment: RuntimeExecPolicyAmendment): Promise<void> {
    this.amendments.execPolicyAmendments.push([...amendment]);
  }

  async appendNetworkPolicyAmendment(amendment: RuntimeNetworkPolicyAmendment): Promise<void> {
    this.amendments.networkPolicyAmendments.push({ ...amendment });
  }
}

class MutableClock implements Clock {
  private value: Date;

  constructor(iso: string) {
    this.value = new Date(iso);
  }

  now(): Date {
    return new Date(this.value);
  }

  set(iso: string): void {
    this.value = new Date(iso);
  }
}

async function appendCompletedExchange(
  threadStore: ThreadStore,
  ids: RandomIdGenerator,
  clock: Clock,
  threadId: string,
  turnId: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  const userCreatedAt = clock.now().toISOString();
  await threadStore.appendEvent(threadId, {
    id: ids.id('event'),
    threadId,
    turnId,
    type: 'message.created',
    createdAt: userCreatedAt,
    payload: {
      message: {
        id: ids.id('msg'),
        turnId,
        role: 'user',
        content: userContent,
        createdAt: userCreatedAt,
        status: 'complete',
      },
    },
  });
  const assistantCreatedAt = clock.now().toISOString();
  const assistantMessageId = ids.id('msg');
  await threadStore.appendEvent(threadId, {
    id: ids.id('event'),
    threadId,
    turnId,
    type: 'message.created',
    createdAt: assistantCreatedAt,
    payload: {
      message: {
        id: assistantMessageId,
        turnId,
        role: 'assistant',
        content: assistantContent,
        createdAt: assistantCreatedAt,
        status: 'complete',
      },
    },
  });
  await threadStore.appendEvent(threadId, {
    id: ids.id('event'),
    threadId,
    turnId,
    type: 'message.completed',
    createdAt: assistantCreatedAt,
    payload: { messageId: assistantMessageId },
  });
}

function nodeEvalHook(script: string): string {
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  return `node -e ${JSON.stringify(`eval(Buffer.from('${encoded}','base64').toString('utf8'))`)}`;
}

function hasToolMessage(messages: RuntimeMessage[], toolName: string): boolean {
  return messages.some((message) => message.role === 'tool' && message.toolName === toolName);
}

function contentIncludesPath(content: string, filePath: string): boolean {
  return content.includes(filePath) || content.includes(JSON.stringify(filePath).slice(1, -1));
}

function childThreadIdFromCollaborationToolMessages(messages: RuntimeMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const parsed = parseToolMessageJson(message.content);
    if (typeof parsed?.newThreadId === 'string') return parsed.newThreadId;
  }
  return '';
}

function parseToolMessageJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

class PersonalizationConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: 'Prefer crisp context before the answer.',
      memory: {
        useMemories: false,
        generateMemories: false,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: false,
      setsunaStyle: 'daily' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class HooksConfigStore implements ConfigStore {
  constructor(private readonly hooks: RuntimeConfigState['hooks']) {}

  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
      hooks: this.hooks,
      bypassHookTrust: true,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class MultiAgentConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: false,
        generateMemories: false,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: false,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
      sandboxWorkspaceWrite: {},
      features: {
        multi_agent: true,
      },
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class ToolSuggestConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: false,
        generateMemories: false,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: false,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
      features: {
        tool_suggest: true,
      },
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class ContextWindowConfigStore implements ConfigStore {
  constructor(private readonly contextWindowTokens: number) {}

  async getConfig(): Promise<RuntimeConfigState> {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [{
        id: 'test',
        name: 'Test provider',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.test/v1',
        enabled: true,
        apiKeySet: true,
        apiKeyPreview: 'secret',
        models: [{
          id: 'local-runtime-smoke',
          name: 'Local runtime smoke',
          code: 'local-runtime-smoke',
          enabled: true,
          contextWindowTokens: this.contextWindowTokens,
          maxOutputTokens: 68_000,
          thinkingEnabled: false,
          thinkingEfforts: [],
        }],
      }],
      globalPrompt: '',
      memory: {
        useMemories: false,
        generateMemories: false,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: false,
      setsunaStyle: 'developer',
      approvalPolicy: 'on-request',
      permissionProfile: 'workspace-write',
    };
  }

  async saveConfig(): Promise<RuntimeConfigState> {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    const config = await this.getConfig();
    const provider = config.providers[0];
    return {
      ...provider,
      apiKey: 'secret',
      activeModel: provider.models[0],
    };
  }
}

class StepSnapshotConfigStore implements ConfigStore {
  getConfigCalls = 0;

  async getConfig() {
    this.getConfigCalls += 1;
    const refreshed = this.getConfigCalls > 2;
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: refreshed ? 'test-updated' : 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: false,
        generateMemories: false,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: false,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: refreshed ? 'workspace-write' as const : 'read-only' as const,
      sandboxWorkspaceWrite: {
        writableRoots: [refreshed ? '/tmp/setsuna-step-writable-2' : '/tmp/setsuna-step-writable'],
        networkAccess: refreshed,
      },
      features: {
        request_permissions_tool: refreshed,
        step_snapshot: true,
        ...(refreshed ? { mid_turn_config_refresh: true } : {}),
      },
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class MemorySettingsConfigStore implements ConfigStore {
  constructor(private readonly memory: RuntimeConfigState['memory']) {}

  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: this.memory,
      memoryEnabled: this.memory.useMemories || this.memory.generateMemories,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class ActiveMemorySettingsConfigStore extends MemorySettingsConfigStore {
  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    const model = {
      id: 'memory-model',
      name: 'Memory model',
      code: 'memory-model',
      enabled: true,
      maxOutputTokens: 2000,
      thinkingEnabled: true,
      thinkingEfforts: ['medium'],
      defaultThinkingEffort: 'medium',
    };
    return {
      id: 'memory-provider',
      name: 'Memory provider',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      enabled: true,
      apiKey: '',
      models: [model],
      activeModel: model,
    };
  }
}

class StrictApprovalConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'strict' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class SandboxWorkspaceWriteConfigStore extends StrictApprovalConfigStore {
  async getConfig() {
    return {
      ...(await super.getConfig()),
      sandboxWorkspaceWrite: {
        writableRoots: ['/tmp/setsuna-extra-writable'],
        networkAccess: false,
      },
    };
  }
}

class ReadOnlyConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'read-only' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class RequestPermissionsDisabledConfigStore extends ReadOnlyConfigStore {
  async getConfig() {
    return {
      ...(await super.getConfig()),
      features: { request_permissions_tool: false },
    };
  }
}

class FullApprovalConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'full' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class ImageCapabilityConfigStore implements ConfigStore {
  constructor(private readonly supportsImages: boolean) {}

  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'vision-provider',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    const model = {
      id: 'vision-model',
      name: 'Vision model',
      code: 'vision-model',
      enabled: true,
      maxOutputTokens: 1000,
      thinkingEnabled: false,
      thinkingEfforts: [],
      supportsImages: this.supportsImages,
    };
    return {
      id: 'vision-provider',
      name: 'Vision provider',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      enabled: true,
      apiKey: '',
      models: [model],
      activeModel: model,
    };
  }
}

async function mkDataDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  return mkdtemp(path.join(tmpdir(), 'setsuna-agent-loop-tools-'));
}

async function waitForPendingApproval(approvalGate: InMemoryApprovalGate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const approvals = await approvalGate.listApprovals();
    const pending = approvals.approvals.find((approval) => approval.status === 'pending');
    if (pending) return pending;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for approval');
}

async function waitForApprovalToolRun(
  threadStore: ThreadStore,
  threadId: string,
  approvalId: string,
  predicate: (run: NonNullable<RuntimeMessage['toolRuns']>[number]) => boolean = () => true,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const thread = await threadStore.getThread(threadId);
    const run = thread?.messages.flatMap((message) => message.toolRuns ?? []).find((item) => item.approvalId === approvalId);
    if (run && predicate(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for approval tool run ${approvalId}`);
}

async function waitForModelAbort(modelClient: { aborted: boolean }) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (modelClient.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for model abort');
}

async function waitForModelRequest(modelClient: { requests: ModelRequest[] }) {
  await waitForModelRequestCount(modelClient, 1);
}

async function waitForModelRequestCount(modelClient: { requests: ModelRequest[] }, count: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (modelClient.requests.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} model request(s); saw ${modelClient.requests.length}.`);
}

async function waitForToolStarts(toolHost: ParallelReadToolHost, count: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (toolHost.started.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} parallel tool starts; saw ${toolHost.started.length}.`);
}

async function waitForTurnCancelled(threadStore: JsonThreadStore, threadId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await threadStore.listEvents(threadId, 0);
    if (events.some((event) => event.type === 'turn.cancelled')) return events;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for turn cancellation');
}

async function waitForTurnCompleted(threadStore: ThreadStore, threadId: string, turnId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await threadStore.listEvents(threadId, 0);
    if (events.some((event) => event.type === 'turn.completed' && event.turnId === turnId)) return events;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for turn completion');
}

function hookContext(): ToolExecutionContext & { turnId: string } {
  return {
    threadId: 'thread_parent',
    turnId: 'turn_child',
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: {},
    features: {},
    signal: new AbortController().signal,
  };
}

function hookEnvironment() {
  return { id: 'local', cwd: '/tmp' };
}

function stepSnapshotSkillRegistry(): SkillRegistry {
  return {
    selectedSkillInjections: async (skillIds?: string[]) => (skillIds?.includes('skill_step')
      ? [{ id: 'skill_step', name: 'Step Skill', content: 'Use the step snapshot fixture.' }]
      : []),
  } as SkillRegistry;
}

function stepSnapshotMcpStore(): Pick<McpStore, 'listServerInputs'> {
  return {
    listServerInputs: async () => [
      { key: 'zeta', transport: 'stdio', command: 'zeta-mcp', enabled: true },
      { key: 'disabled', transport: 'stdio', command: 'disabled-mcp', enabled: false },
      { key: 'alpha', transport: 'streamableHttp', url: 'https://mcp.example.test', enabled: true },
    ],
  };
}

function hookEventCapture() {
  const started: RuntimeHookRun[] = [];
  const completed: RuntimeHookRun[] = [];
  return {
    started,
    completed,
    publishHookStarted: async (run: RuntimeHookRun) => {
      started.push(run);
    },
    publishHookCompleted: async (run: RuntimeHookRun) => {
      completed.push(run);
    },
  };
}
