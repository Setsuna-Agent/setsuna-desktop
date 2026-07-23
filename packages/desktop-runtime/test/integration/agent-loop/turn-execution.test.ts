import {
  RUNTIME_DEVELOPER_FEATURES_FLAG,
  type RuntimeConfigState,
  type RuntimeEvent,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  CapturingToolHost,
  CapturingUsageStore,
  MemoryCapturingModelClient,
  mkDataDir,
  stepSnapshotSkillRegistry,
  ToolCallingModelClient,
  waitForTurnCompleted,
  WORKSPACE_READ_FILE_TOOL
} from '../../support/agent-loop/shared.js';
import {
  EmptyModelClient,
  FailingCleanupToolHost,
  PlanDeltaOnlyModelClient,
  PlanThenToolModelClient,
  ProviderMetadataToolModelClient,
  RefreshingToolHost,
  StepSnapshotConfigStore,
  stepSnapshotMcpStore,
  StepSnapshotModelClient,
} from '../../support/agent-loop/turn-execution.js';

describe('agent loop turn execution', () => {
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
          inputTokens: 5,
          outputTokens: 6,
          totalTokens: 11,
        },
      ]);
    });
  
  it('persists provider metadata and carries it into the tool-result sampling step', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Provider metadata tool loop', projectId: 'project_1' });
      const modelClient = new ProviderMetadataToolModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost: new CapturingToolHost(),
      });
  
      await loop.sendTurn(thread.id, { input: 'read with thinking' });
  
      const expectedMetadata = {
        anthropic: {
          contentBlocks: [
            { type: 'thinking', thinking: 'Need the file.', signature: 'opaque-signature' },
            { type: 'tool_use', id: 'call_metadata_1', name: 'workspace_read_file', input: { path: 'README.md' } },
          ],
        },
      } as const;
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
      const toolAssistant = saved?.messages.find((message) => message.role === 'assistant' && message.toolCalls?.length);
      const continuedAssistant = modelClient.requests[1]?.messages.find((message) => message.role === 'assistant' && message.toolCalls?.length);
  
      expect(toolAssistant?.providerMetadata).toEqual(expectedMetadata);
      expect(continuedAssistant?.providerMetadata).toEqual(expectedMetadata);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'message.completed',
        payload: expect.objectContaining({ providerMetadata: expectedMetadata }),
      }));
    });
  
  it('fails an empty model stream instead of completing a blank assistant message', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Empty model response' });
      const loop = new AgentLoop({
        threadStore,
        modelClient: new EmptyModelClient(),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });
  
      await expect(loop.sendTurn(thread.id, { input: 'hello' })).rejects.toThrow('模型服务返回了空响应');
  
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
      expect(saved?.turns?.at(-1)).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('模型服务返回了空响应'),
      });
      expect(saved?.messages.find((message) => message.role === 'assistant')).toMatchObject({
        content: '',
        status: 'error',
        error: expect.stringContaining('模型服务返回了空响应'),
      });
      expect(events.some((event) => event.type === 'runtime.error')).toBe(true);
      expect(events.some((event) => event.type === 'turn.completed')).toBe(false);
    });
  
  it('keeps a completed turn terminal when tool cleanup fails', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Cleanup warning', projectId: 'project_1' });
      const loop = new AgentLoop({
        threadStore,
        modelClient: new ToolCallingModelClient(),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost: new FailingCleanupToolHost(),
      });
  
      await expect(loop.sendTurn(thread.id, { input: 'read the file' })).resolves.toBeUndefined();
  
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
      const turn = saved?.turns?.at(-1);
      expect(turn).toMatchObject({ status: 'completed' });
      expect(turn?.error).toBeUndefined();
      expect(saved?.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'complete' });
      expect(events).toContainEqual(expect.objectContaining({
        type: 'runtime.warning',
        payload: expect.objectContaining({ code: 'tool_cleanup_failed' }),
      }));
      expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
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
      expect(toolHost.environmentCalls).toBe(2);
      expect(snapshotEvents.map((event) => event.payload.snapshot.toolNames)).toEqual([
        ['step_tool_1'],
        ['step_tool_2'],
      ]);
      expect(snapshotEvents.map((event) => event.payload.snapshot.advertisedToolNames)).toEqual([
        ['step_tool_1'],
        ['step_tool_2'],
      ]);
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
        toolChoice: 'auto',
        toolEnvironment: {
          id: expect.stringMatching(/^step_env_\d+$/),
          cwd: expect.stringMatching(/^\/tmp\/setsuna-step-\d+$/),
          workspaceRoot: expect.stringMatching(/^\/tmp\/setsuna-step-\d+$/),
          workspaceRoots: [expect.stringMatching(/^\/tmp\/setsuna-step-\d+$/)],
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
          messageTokens: expect.any(Number),
          toolDefinitionTokens: expect.any(Number),
          reservedOutputTokens: expect.any(Number),
          maxContextTokens: expect.any(Number),
          maxContextTokensK: expect.any(Number),
          messageCount: expect.any(Number),
          tokensUntilCompaction: expect.any(Number),
        },
        featureKeys: ['request_permissions_tool', 'step_snapshot'],
        promptManifest: expect.arrayContaining([
          expect.objectContaining({ id: 'desktop_runtime_base', role: 'system', source: 'product', trust: 'runtime' }),
          expect.objectContaining({ id: 'desktop_runtime_environment', role: 'developer', source: 'environment', trust: 'runtime' }),
          expect.objectContaining({ id: 'desktop_runtime_permissions', role: 'developer', source: 'permissions', trust: 'runtime' }),
          expect.objectContaining({ id: 'skill_skill_step', role: 'user', source: 'skill', trust: 'user' }),
        ]),
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
          workspaceRoot: expect.stringMatching(/^\/tmp\/setsuna-step-\d+$/),
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
      expect(modelClient.requests[0].stepSnapshot?.messageIds).toContain('desktop_runtime_environment');
      expect(modelClient.requests[0].stepSnapshot?.threadLastSeq).toEqual(expect.any(Number));
      expect(modelClient.requests[0].stepSnapshot?.contextWindow?.estimatedTokens).toBeGreaterThan(0);
      expect(modelClient.requests[0].stepSnapshot?.contextWindow?.tokensUntilCompaction).toBeGreaterThan(0);
      expect(toolHost.runContexts[0].environment).toBe(firstSnapshotEnvironment);
    });

  it('uses the committed step event only as a transient developer trace anchor', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Debug trace anchor' });
      const modelClient = new MemoryCapturingModelClient();
      const config = developerFeaturesConfig();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        configStore: {
          getConfig: async () => config,
          saveConfig: async () => config,
          getActiveProviderConfig: async () => null,
        },
      });

      await loop.sendTurn(thread.id, { input: 'capture the debug anchor' });

      const events = await threadStore.listEvents(thread.id, 0);
      const stepEvent = events.find(
        (event): event is Extract<RuntimeEvent, { type: 'turn.step_snapshot' }> => (
          event.type === 'turn.step_snapshot'
        ),
      );
      expect(stepEvent).toBeDefined();
      expect(modelClient.requests[0].stepSnapshot?.threadLastSeq).toBe(stepEvent?.seq);
      expect(modelClient.requests[0].stepSnapshot?.featureKeys).toContain(
        RUNTIME_DEVELOPER_FEATURES_FLAG,
      );
      expect(stepEvent?.payload.snapshot.threadLastSeq).toBeLessThan(stepEvent?.seq ?? 0);
      expect(stepEvent?.payload.snapshot.featureKeys).not.toContain(
        RUNTIME_DEVELOPER_FEATURES_FLAG,
      );
    });
  
  it('injects project workflow and instructions before the first model sampling step', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Project instructions', projectId: 'project_1' });
      const modelClient = new MemoryCapturingModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        projectWorkflow: {
          resolve: async () => ({
            root: '/workspace',
            cwd: '/workspace',
            manifests: [{ kind: 'node-package', path: '/workspace/package.json', directory: '/workspace' }],
            packageManager: { name: 'pnpm', version: '7.33.7', evidence: ['package.json#packageManager'] },
            scripts: [{
              name: 'test',
              definition: 'vitest run --config vitest.unit.config.ts',
              invocation: 'pnpm test',
              cwd: '/workspace',
              sourcePath: '/workspace/package.json',
              truncated: false,
            }],
            warnings: [],
          }),
        },
        projectInstructions: {
          load: async () => [{
            content: 'Use pnpm and keep runtime boundaries intact.',
            directory: '/workspace',
            path: '/workspace/AGENTS.md',
            truncated: false,
          }],
        },
      });
  
      await loop.sendTurn(thread.id, { input: 'inspect the project rules' });
  
      const request = modelClient.requests[0];
      expect(request.messages.find((message) => message.id === 'desktop_project_workflow')).toMatchObject({
        role: 'user',
        content: expect.stringContaining('<invocation>pnpm test</invocation>'),
      });
      expect(request.messages.find((message) => message.id === 'project_instruction_0')).toMatchObject({
        role: 'user',
        content: expect.stringContaining('Use pnpm and keep runtime boundaries intact.'),
      });
      expect(request.stepSnapshot?.promptManifest).toContainEqual(expect.objectContaining({
        id: 'desktop_project_workflow',
        role: 'user',
        source: 'project_workflow',
        trust: 'external',
        lifecycle: 'workspace',
      }));
      expect(request.stepSnapshot?.promptManifest).toContainEqual(expect.objectContaining({
        id: 'project_instruction_0',
        role: 'user',
        source: 'project_instruction',
        sourcePath: '/workspace/AGENTS.md',
      }));
      expect((await threadStore.getThread(thread.id))?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
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
      expect(modelClient.requests[0].messages.some((message) => message.id === 'desktop_local_tool_rules')).toBe(false);
      expect(modelClient.requests[0].stepSnapshot?.contextWindow?.toolDefinitionTokens).toBe(0);
      expect(modelClient.requests[0].messages.some((message) => message.id === 'desktop_plan_mode' && message.content.includes('<plan_mode>'))).toBe(true);
      expect(toolHost.calls).toEqual([]);
      expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(saved?.messages.at(-1)?.content).toContain('Plan mode is active');
      expect(saved?.messages.at(-1)?.planMode).toEqual({ mode: 'plan', status: 'awaiting_confirmation' });
    });
  
  it('uses the dedicated review policy and exposes only read-only review tools', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Review profile', projectId: 'project_1' });
      const modelClient = new MemoryCapturingModelClient();
      const toolHost = new CapturingToolHost([
        WORKSPACE_READ_FILE_TOOL,
        { name: 'git_log', description: 'Read Git history', inputSchema: {} },
        { name: 'git_show', description: 'Read a Git revision', inputSchema: {} },
        { name: 'write_file', description: 'Write a file', inputSchema: {} },
      ]);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });
  
      const started = await loop.startReview(thread.id, {
        displayText: 'current changes',
        prompt: 'Review the current uncommitted changes.',
      });
      await waitForTurnCompleted(threadStore, thread.id, started.turnId);
  
      expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['workspace_read_file', 'git_log', 'git_show']);
      expect(modelClient.requests[0].messages.find((message) => message.id === 'desktop_review_policy')).toMatchObject({
        role: 'developer',
        content: expect.stringContaining('do not modify files'),
      });
      expect(modelClient.requests[0].stepSnapshot?.promptManifest).toContainEqual(expect.objectContaining({
        id: 'desktop_review_policy',
        source: 'review',
        role: 'developer',
      }));
      expect(modelClient.requests[0].messages).toContainEqual(expect.objectContaining({
        role: 'user',
        content: 'Review the current uncommitted changes.',
      }));
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
});

function developerFeaturesConfig(): RuntimeConfigState {
  return {
    approvalPolicy: 'on-request',
    configPath: '/tmp/config.json',
    dataPath: '/tmp',
    features: { [RUNTIME_DEVELOPER_FEATURES_FLAG]: true },
    globalPrompt: '',
    memory: {
      dedicatedTools: false,
      disableOnExternalContext: true,
      generateMemories: false,
      useMemories: false,
    },
    memoryEnabled: false,
    permissionProfile: 'workspace-write',
    providers: [],
    setsunaStyle: 'developer',
    storagePath: '/tmp/memories',
  };
}
