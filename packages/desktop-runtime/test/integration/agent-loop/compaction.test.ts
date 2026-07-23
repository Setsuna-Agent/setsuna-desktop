import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  AutoCompactionModelClient,
  BlockingContextCompactionModelClient,
  ContextCompactionModelClient,
  LateLargeToolResultHost,
  longAgentLoopTestTimeoutMs,
  LongToolChainCompactionModelClient,
  LongToolChainModelClient,
  RemoteCompactionModelClient,
} from '../../support/agent-loop/compaction.js';
import {
  CapturingToolHost,
  CapturingUsageStore,
  ContextWindowConfigStore,
  HooksConfigStore,
  mkDataDir,
  nodeEvalHook
} from '../../support/agent-loop/shared.js';

describe('agent loop context compaction', () => {
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

  it('keeps only the nearest reused-id tool transaction across a manual compaction boundary', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Repeated tool id compaction' });
    const messages: RuntimeMessage[] = [
      {
        id: 'old_user',
        role: 'user',
        content: 'Inspect both files.',
        createdAt: '2026-06-26T00:10:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_first',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-26T00:10:01.000Z',
        status: 'complete',
        toolCalls: [{ id: 'call_0', name: 'read_file', arguments: '{"file_path":"one.txt"}' }],
      },
      {
        id: 'tool_first',
        role: 'tool',
        toolCallId: 'call_0',
        toolName: 'read_file',
        content: 'one',
        createdAt: '2026-06-26T00:10:02.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_second',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-26T00:10:03.000Z',
        status: 'complete',
        toolCalls: [{ id: 'call_0', name: 'read_file', arguments: '{"file_path":"two.txt"}' }],
      },
      {
        id: 'tool_second',
        role: 'tool',
        toolCallId: 'call_0',
        toolName: 'read_file',
        content: 'two',
        createdAt: '2026-06-26T00:10:04.000Z',
        status: 'complete',
      },
      ...Array.from({ length: 7 }, (_, index): RuntimeMessage => ({
        id: `recent_reused_${index}`,
        role: index % 2 ? 'assistant' : 'user',
        content: `recent ${index}`,
        createdAt: `2026-06-26T00:10:${String(index + 5).padStart(2, '0')}.000Z`,
        status: 'complete',
      })),
    ];
    for (const message of messages) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: message.createdAt,
        payload: { message },
      });
    }
    const loop = new AgentLoop({
      threadStore,
      modelClient: new ContextCompactionModelClient(),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const compacted = await loop.compactThreadContext(thread.id);
    const summary = compacted.messages.find((message) => message.contextCompaction);

    expect(summary?.contextCompaction?.compactedMessageCount).toBe(3);
    expect(compacted.messages.find((message) => message.id === 'assistant_first')?.visibility).toBe('transcript');
    expect(compacted.messages.find((message) => message.id === 'tool_first')?.visibility).toBe('transcript');
    expect(compacted.messages.find((message) => message.id === 'assistant_second')?.visibility).not.toBe('transcript');
    expect(compacted.messages.find((message) => message.id === 'tool_second')?.visibility).not.toBe('transcript');
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
      });
      expect(modelClient.compactRequests[0].messages.map((message) => message.content).join('\n')).toContain(smallWindowHistory.slice(0, 200));
      expect(modelClient.requests.map((request) => request.model)).toEqual(['context-compaction', 'local-runtime-smoke']);
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
  
  it('automatically compacts oversized tool results during a long tool chain', async () => {
      const toolCallBatches = 5;
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Mid-turn context compaction', projectId: 'project_1' });
      const modelClient = new LongToolChainCompactionModelClient(toolCallBatches);
      const toolHost = new LateLargeToolResultHost(toolCallBatches);
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
      const mainRequests = modelClient.requests.filter((request) => request.model === 'local-runtime-smoke');
      const followUpRequest = mainRequests.at(-1)!;
  
      expect(modelClient.requests.map((request) => request.model)).toEqual([
        ...Array.from({ length: toolCallBatches }, () => 'local-runtime-smoke'),
        'context-compaction',
        'local-runtime-smoke',
      ]);
      expect(toolHost.calls).toHaveLength(toolCallBatches);
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
  
  it('keeps tools available until the model ends a long tool chain', async () => {
      const toolCallBatches = 5;
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Long tool chain', projectId: 'project_1' });
      const modelClient = new LongToolChainModelClient(toolCallBatches);
      const toolHost = new CapturingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });
  
      await loop.sendTurn(thread.id, { input: 'keep inspecting files' });
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
      expect(events.some((event) => event.type === 'turn.completed')).toBe(true);
      expect(modelClient.requests).toHaveLength(toolCallBatches + 1);
      expect(modelClient.requests.every((request) => request.toolChoice !== 'none')).toBe(true);
      expect(modelClient.requests.every((request) => request.tools?.some((tool) => tool.name === 'workspace_read_file'))).toBe(true);
      expect(modelClient.requests.every((request) => (request.stepSnapshot?.contextWindow?.toolDefinitionTokens ?? 0) > 0)).toBe(true);
      expect(toolHost.calls).toHaveLength(toolCallBatches);
      expect(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.status === 'error'
        && event.payload.content.includes('budget')
      )).toBe(false);
      expect(saved?.messages.at(-1)?.content).toBe('Final answer after the available tool results.');
      expect(saved?.messages.at(-1)?.status).toBe('complete');
    }, longAgentLoopTestTimeoutMs);
});
