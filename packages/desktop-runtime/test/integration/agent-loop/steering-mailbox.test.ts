import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  ContextWindowConfigStore,
  mkDataDir,
  stepSnapshotSkillRegistry,
  ToolCallingModelClient,
  waitForModelRequestCount,
  waitForTurnCompleted
} from '../../support/agent-loop/shared.js';
import {
  BlockingToolHost,
  BlockingUserShellHost,
  DelayedSteerAppendThreadStore,
  MailboxAwareModelClient,
  OversizedSteerCompactionModelClient,
  SteerableModelClient,
} from '../../support/agent-loop/steering-mailbox.js';

describe('agent loop turn steering and mailbox input', () => {
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
  
      const running = loop.runUserShellCommand(thread.id, 'node -e "setInterval(() => {}, 1000)"');
      await toolHost.started;
      const turnId = loop.activeTurnId(thread.id);
  
      expect(turnId).toBeTruthy();
      expect(toolHost.calls).toEqual([{
        command: 'node -e "setInterval(() => {}, 1000)"',
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
  
      const running = loop.runUserShellCommand(thread.id, 'node -e "setInterval(() => {}, 1000)"');
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
        skillRegistry: stepSnapshotSkillRegistry(),
      });
  
      const started = await loop.startTurn(thread.id, { input: 'initial prompt' });
      await waitForModelRequestCount(modelClient, 1);
  
      await expect(loop.steerTurn(thread.id, {
        clientId: 'client-steer-1',
        expectedTurnId: started.turnId,
        input: 'Prefer the shorter path.',
        skillIds: ['skill_step'],
        thinking: true,
        thinkingEffort: 'high',
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
      expect(modelClient.requests[1]).toMatchObject({ thinking: true, reasoningEffort: 'high' });
      expect(modelClient.requests[1].stepSnapshot?.messageIds).toContain('skill_skill_step');
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
  
      await loop.sendTurn(thread.id, { input: 'Continue in the same thread.' });
      const resumedMessages = modelClient.requests[2].messages;
      const resumedToolCallIndex = resumedMessages.findIndex((message) =>
        message.role === 'assistant' && message.toolCalls?.some((call) => call.id === 'call_1')
      );
      const resumedToolResultIndex = resumedMessages.findIndex((message) => message.toolCallId === 'call_1');
      const resumedSteerIndex = resumedMessages.findIndex((message) => message.clientId === 'client-steer-during-tool');
  
      expect(resumedToolCallIndex).toBeGreaterThanOrEqual(0);
      expect(resumedToolResultIndex).toBeGreaterThan(resumedToolCallIndex);
      expect(resumedSteerIndex).toBeGreaterThan(resumedToolResultIndex);
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
        role: 'user',
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
});
