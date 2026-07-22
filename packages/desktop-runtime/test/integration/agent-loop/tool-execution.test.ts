import type {
  RuntimeEvent
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  CapturingToolHost,
  mkDataDir,
  PreviewingToolHost,
  SingleToolCallModelClient,
  ToolDeltaModelClient,
  waitForTurnCancelled
} from '../../support/agent-loop/shared.js';
import {
  CountingReadToolHost,
  DirectLookupToolModelClient,
  ForcedToolChoiceHost,
  ForcedToolChoiceModelClient,
  LargePreviewingToolHost,
  LookupPreviewingToolHost,
  LookupToolDeltaModelClient,
  LookupToolHost,
  ManyInspectionModelClient,
  NoisyToolDeltaModelClient,
  OutputDeltaToolHost,
  ParallelReadModelClient,
  ParallelReadToolHost,
  ParallelSearchModelClient,
  SandboxWorkspaceWriteConfigStore,
  SerialProfileReadToolHost,
  ShellOutputDeltaModelClient,
  waitForToolStarts
} from '../../support/agent-loop/tool-execution.js';

describe('agent loop tool execution', () => {
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
  
  it('runs search_text calls emitted in the same model response in parallel', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Parallel searches', projectId: 'project_1' });
      const modelClient = new ParallelSearchModelClient();
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
  
      const turn = loop.sendTurn(thread.id, { input: 'search for both independent terms' });
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
      expect(toolHost.started).toEqual(['search_text', 'search_text']);
      expect(modelClient.requests).toHaveLength(2);
      expect(saved?.messages.filter((message) => message.role === 'tool').map((message) => message.toolName)).toEqual(['search_text', 'search_text']);
      expect(saved?.messages.at(-1)?.content).toContain('parallel search results received');
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
  
  it('advertises host tools directly on the first sampling step', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Direct tools', projectId: 'project_1' });
      const modelClient = new DirectLookupToolModelClient();
      const toolHost = new LookupToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });
  
      await loop.sendTurn(thread.id, { input: 'look up the project fact' });
      const saved = await threadStore.getThread(thread.id);
  
      expect(modelClient.requests).toHaveLength(2);
      expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['direct_tool', 'project_lookup']);
      expect(modelClient.requests[0].stepSnapshot?.toolNames).toEqual(['direct_tool', 'project_lookup']);
      expect(modelClient.requests[0].stepSnapshot?.advertisedToolNames).toEqual(['direct_tool', 'project_lookup']);
      expect(modelClient.requests[0].stepSnapshot?.toolRuntimes).toEqual([
        {
          name: 'direct_tool',
          source: 'host',
          exposure: 'direct',
          supportsParallel: false,
          waitsForRuntimeCancellation: true,
        },
        {
          name: 'project_lookup',
          source: 'host',
          exposure: 'direct',
          supportsParallel: false,
          waitsForRuntimeCancellation: true,
        },
      ]);
      expect(toolHost.calls).toEqual([{ name: 'project_lookup', input: { id: 'alpha' }, projectId: 'project_1' }]);
      expect(saved?.messages.filter((message) => message.role === 'tool').map((message) => message.toolName)).toEqual(['project_lookup']);
      expect(saved?.messages.at(-1)?.content).toContain('direct lookup complete');
    });
  
  it('advertises AppServer dynamic tools directly', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Direct dynamic tool', projectId: 'project_1' });
      const modelClient = new SingleToolCallModelClient({
        id: 'call_dynamic_lookup',
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
        description: 'Look up a ticket by id.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      }], 'dynamic-connection-1');
  
      await loop.sendTurn(thread.id, { input: 'call the dynamic lookup directly' });
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['workspace_read_file', 'tickets__lookup_ticket']);
      expect(modelClient.requests[0].stepSnapshot?.toolNames).toEqual(['workspace_read_file', 'tickets__lookup_ticket']);
      expect(modelClient.requests[0].stepSnapshot?.advertisedToolNames).toEqual(['workspace_read_file', 'tickets__lookup_ticket']);
      expect(toolHost.calls).toEqual([]);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool.completed',
        payload: expect.objectContaining({
          toolName: 'tickets__lookup_ticket',
          status: 'error',
          content: expect.stringContaining('AppServer dynamic tool runtime is unavailable'),
        }),
      }));
      expect(saved?.messages.find((message) => message.role === 'tool' && message.toolName === 'tickets__lookup_ticket')?.content)
        .toContain('AppServer dynamic tool runtime is unavailable');
      expect(saved?.messages.at(-1)?.content).toContain('tool handled');
    });
  
  it('cancels an AppServer dynamic tool without publishing a tool error', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Cancel dynamic tool', projectId: 'project_1' });
      let notifyStarted!: () => void;
      const dynamicCallStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
      const loop = new AgentLoop({
        threadStore,
        modelClient: new SingleToolCallModelClient({
          id: 'call_dynamic_cancel',
          name: 'tickets__wait_for_ticket',
          arguments: '{"id":"ABC-123"}',
        }),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost: new CapturingToolHost(),
        appServerNotificationBus: {
          publish: (notification) => {
            if (notification.method === 'item/tool/call') notifyStarted();
          },
          subscribe: () => () => undefined,
        },
      });
      loop.registerAppServerDynamicTools(thread.id, [{
        name: 'tickets__wait_for_ticket',
        namespace: 'tickets',
        toolName: 'wait_for_ticket',
        description: 'Wait for a ticket response.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      }], 'dynamic-connection-1');
  
      const started = await loop.startTurn(thread.id, { input: 'wait on the dynamic tool' });
      await dynamicCallStarted;
      await expect(loop.cancelTurn(thread.id, started.turnId)).resolves.toBe(true);
      const events = await waitForTurnCancelled(threadStore, thread.id);
  
      expect(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.toolCallId === 'call_dynamic_cancel'
      )).toBe(false);
      expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
    });
  
  it('executes all inspection calls without injecting progress copy', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Inspection batch', projectId: 'project_1' });
      const modelClient = new ManyInspectionModelClient();
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
  
      expect(toolHost.calls).toHaveLength(10);
      expect(toolHost.calls.map((input) => input.file_path)).toEqual([
        'src/file-1.ts',
        'src/file-2.ts',
        'src/file-3.ts',
        'src/file-4.ts',
        'src/file-5.ts',
        'src/file-6.ts',
        'src/file-7.ts',
        'src/file-8.ts',
        'src/file-9.ts',
        'src/file-10.ts',
      ]);
      expect(modelClient.requests).toHaveLength(2);
      expect(assistantWithTools?.content).toBe('');
      expect(assistantWithTools?.toolCalls).toHaveLength(10);
      expect(assistantWithTools?.toolRuns).toHaveLength(10);
      expect(secondRequestToolMessages).toHaveLength(10);
      expect(secondRequestToolMessages.every((message) => message.content.startsWith('contents for src/file-'))).toBe(true);
      expect(events.filter((event) => event.type === 'tool.started')).toHaveLength(10);
      expect(events.filter((event) => event.type === 'tool.completed')).toHaveLength(10);
      expect(saved?.messages.at(-1)?.content).toContain('inspection complete');
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
        event.type === 'tool.preview'
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
  
  it('keeps large structured tool result previews valid for thread projections', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Large structured preview', projectId: 'project_1' });
      const loop = new AgentLoop({
        threadStore,
        modelClient: new ToolDeltaModelClient(),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost: new LargePreviewingToolHost(),
      });
  
      await loop.sendTurn(thread.id, { input: 'write a large file' });
      const saved = await threadStore.getThread(thread.id);
      const resultPreview = saved?.messages
        .flatMap((message) => message.toolRuns ?? [])
        .find((run) => run.id === 'call_delta')?.resultPreview;
  
      expect(resultPreview?.length).toBeGreaterThan(60_000);
      expect(JSON.parse(resultPreview ?? '{}')).toMatchObject({
        diff: { path: 'src/generated.txt', additions: 1, deletions: 0 },
      });
    });
  
  it('bounds persisted previews for token-heavy tool arguments', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Noisy tool delta loop', projectId: 'project_1' });
      const modelClient = new NoisyToolDeltaModelClient();
      const toolHost = new PreviewingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });
  
      await loop.sendTurn(thread.id, { input: 'write a large file' });
      const events = await threadStore.listEvents(thread.id, 0);
      const previews = events.filter((event) => event.type === 'tool.preview' && event.payload.toolCallId === 'call_noisy_delta');
      const starts = events.filter((event) => event.type === 'tool.started' && event.payload.toolCallId === 'call_noisy_delta');
  
      expect(toolHost.partialPreviewCalls.length).toBeGreaterThan(1);
      expect(toolHost.partialPreviewCalls.length).toBeLessThanOrEqual(6);
      expect(previews).toHaveLength(1);
      expect(previews[0]).toMatchObject({ payload: { argumentsLength: expect.any(Number) } });
      expect((previews[0] as Extract<RuntimeEvent, { type: 'tool.preview' }>).payload.argumentsLength).toBeGreaterThan(4_000);
      expect(starts).toHaveLength(1);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool.completed',
        payload: expect.objectContaining({ toolCallId: 'call_noisy_delta', status: 'success' }),
      }));
    });
  
  it('publishes streaming previews for directly advertised tools', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Direct delta preview', projectId: 'project_1' });
      const modelClient = new LookupToolDeltaModelClient();
      const toolHost = new LookupPreviewingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });
  
      await loop.sendTurn(thread.id, { input: 'stream lookup arguments' });
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.partialPreviewCalls).toEqual([
        { name: 'project_lookup', rawArguments: '{"id":"alpha"}' },
      ]);
      expect(events.some((event) => event.type === 'tool.preview' && event.payload.toolName === 'project_lookup')).toBe(true);
      expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['direct_tool', 'project_lookup']);
    });
});
