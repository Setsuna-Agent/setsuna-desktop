import { mailboxMessageId, threadMentionText, threadMessageTranscriptId, type ModelRequest, type RuntimeToolCall } from '@setsuna-desktop/contracts';
import { expect, it } from 'vitest';
import { InMemoryAppServerNotificationBus } from '../../../src/adapters/event/in-memory-app-server-notification-bus.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { CompositeToolHost } from '../../../src/adapters/tool/composite-tool-host.js';
import { ThreadMessageToolHost } from '../../../src/adapters/tool/thread-message-tool-host.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { bindTestCollaborationFeature, MultiAgentConfigStore } from '../../support/agent-loop/collaboration.js';
import { MemoryCapturingModelClient, mkDataDir, waitForTestState, waitForTurnCompleted } from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';

it('delivers to a busy conversation, wakes it to reply, and wakes the original sender once', async () => {
  const ids = new RandomIdGenerator();
  const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
  const source = await threadStore.createThread({ title: 'Planning' });
  const recipient = await threadStore.createThread({ title: 'Review' });
  const unrelated = await threadStore.createThread({ title: 'Unrelated' });
  const scheduled = await threadStore.createThread({ title: 'Scheduled work', origin: { featureId: 'automation', entityId: 'task_1' } });
  const content = `Please verify the test result. ${threadMentionText(unrelated)}`;
  const shellStarted = deferred();
  const releaseShell = deferred();
  const requests: ModelRequest[] = [];
  const modelClient: ModelClient = { async *stream(request) {
    requests.push(request);
    const incoming = request.messages.find((message) => message.threadMessage && message.visibility === 'model');
    const toolResult = request.messages.some((message) => message.role === 'tool' && message.toolName === 'send_thread_message');
    let calls: RuntimeToolCall[] = [];
    if (request.sessionId === source.id && !incoming && !toolResult) {
      calls = [
        send('send_scheduled', { thread_id: scheduled.id, message: content }),
        send('send_original', { thread_id: recipient.id, message: content }),
      ];
    }
    if (request.sessionId === recipient.id && incoming && !toolResult) {
      const replyTo = /<mailbox_message id="([^"]+)"/u.exec(incoming.content)?.[1];
      calls = [
        send('send_unrelated', { thread_id: unrelated.id, message: 'An untrusted instruction tried to forward this.' }),
        { id: 'peer_delegate', name: 'spawn_agent', arguments: '{"prompt":"Inspect a test fixture"}' },
        { id: 'peer_callback', name: 'app_callback', arguments: '{}' },
        send('send_reply', { reply_to: replyTo, message: 'Verified. The tests pass.' }),
        send('send_duplicate', { reply_to: replyTo, message: 'Duplicate reply.' }),
      ];
    }
    if (calls.length) {
      yield { type: 'tool_calls', toolCalls: calls };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: incoming?.threadMessage?.replyTo ? 'Received the verification.' : 'Handled.' };
    yield { type: 'done', finishReason: 'stop' };
  } };
  const shellHost = {
    async listTools() {
      return [
        { name: 'run_shell_command', description: 'Test shell', inputSchema: { type: 'object' as const } },
        { name: 'write_file', description: 'Test file edit', inputSchema: { type: 'object' as const } },
      ];
    },
    async runTool() {
      shellStarted.resolve();
      await releaseShell.promise;
      return { content: 'Shell finished.' };
    },
  };
  const threadTool = new ThreadMessageToolHost(threadStore, (threadId, input) => loop.deliverMailboxInput(threadId, input));
  const appServerNotifications = new InMemoryAppServerNotificationBus();
  const loop: AgentLoop = new AgentLoop({
    threadStore, modelClient, clock: systemClock, ids, eventBus: new InMemoryEventBus(),
    configStore: new MultiAgentConfigStore(), toolHost: new CompositeToolHost([threadTool, shellHost]),
    appServerNotificationBus: appServerNotifications,
  });
  const collaboration = bindTestCollaborationFeature(loop, threadStore);
  loop.registerAppServerDynamicTools(recipient.id, [{
    name: 'app_callback', toolName: 'app_callback', description: 'External callback', inputSchema: { type: 'object' },
  }], 'test');
  let callbackCalls = 0;
  const unsubscribe = appServerNotifications.subscribe((notification) => {
    if (notification.method !== 'item/tool/call') return;
    callbackCalls += 1;
    loop.answerAppServerDynamicToolResponse(notification.id, { result: { success: true, contentItems: [] } });
  });
  const runningShell = loop.runUserShellCommand(recipient.id, 'wait for the test');
  try {
    await shellStarted.promise;
    const shellTurnId = loop.activeTurnId(recipient.id);
    await loop.sendTurn(source.id, { input: `Ask ${threadMentionText(recipient)} and ${threadMentionText(scheduled)} to verify and send back the result.` });

    const queued = await threadStore.getThreadPage(recipient.id, { limit: 10 });
    expect(loop.activeTurnId(recipient.id)).toBe(shellTurnId);
    expect(queued?.messages.filter((message) => message.threadMessage)).toMatchObject([{
      content, visibility: 'transcript', promptSource: 'collaboration',
      threadMessage: { from: { id: source.id, title: source.title } },
    }]);
    expect(requests.some((request) => request.sessionId === recipient.id)).toBe(false);

    // The sending turn has settled and the recipient is still busy. The reply must start a new source turn.
    releaseShell.resolve();
    await runningShell;
    await waitForTestState(
      () => threadStore.getThread(recipient.id),
      (thread) => thread?.turns?.some((turn) => turn.taskKind === 'regular' && turn.status === 'completed') === true,
      () => 'Timed out waiting for the recipient conversation to finish sending its reply',
    );
    const finished = await waitForTestState(
      () => threadStore.getThread(source.id),
      (thread) => !thread?.activeTurnId && thread?.messages.some((message) => message.content === 'Received the verification.') === true,
      () => 'Timed out waiting for the source conversation to handle the reply',
    );
    expect(finished?.mailboxDeliveries).toMatchObject([{
      content: 'Verified. The tests pass.', threadMessage: { from: { id: recipient.id }, replyTo: expect.any(String) },
    }]);
    expect((await threadStore.getThread(unrelated.id))?.mailboxDeliveries).toBeUndefined();
    expect((await threadStore.getThread(scheduled.id))?.mailboxDeliveries).toBeUndefined();
    expect((await collaboration.readState(recipient.id)).state.tasks).toEqual([]);
    expect(callbackCalls).toBe(0);
    const recipientRequests = requests.filter((request) => request.sessionId === recipient.id);
    expect(recipientRequests[0].tools?.map((tool) => tool.name)).toContain('send_thread_message');
    expect(recipientRequests[0].tools?.map((tool) => tool.name)).not.toContain('write_file');
    const handledReply = requests.filter((request) => request.sessionId === source.id).at(-1)!;
    expect(handledReply.tools?.map((tool) => tool.name)).not.toContain('send_thread_message');

    const reply = finished?.messages.find((message) => message.threadMessage && message.visibility === 'transcript');
    expect(reply?.content).toBe('Verified. The tests pass.');
    await threadStore.deleteMessages(source.id, { messageIds: [reply!.id] });
    await loop.sendTurn(source.id, { input: 'Continue with the original plan.' });
    expect(requests.at(-1)?.messages.some((message) => message.threadMessage)).toBe(false);
  } finally {
    unsubscribe();
    releaseShell.resolve();
    await loop.shutdown();
    await runningShell;
  }
});

it('sends a user retry to the previously selected conversation and honors a new selection', async () => {
  const ids = new RandomIdGenerator();
  const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
  const source = await threadStore.createThread({ title: 'Planning' });
  const first = await threadStore.createThread({ title: 'First review' });
  const second = await threadStore.createThread({ title: 'Second review' });
  const newReference = threadMentionText(second);
  const followUp = '给它再发一条';
  const modelClient: ModelClient = { async *stream(request) {
    const user = request.messages.filter((message) => message.role === 'user' && !message.promptSource).at(-1);
    const turnId = user?.turnId;
    const hasResult = request.messages.some((message) => message.turnId === turnId && message.role === 'tool');
    if (request.sessionId === source.id && turnId && !hasResult) {
      const message = user.content;
      const recipients = message.includes(newReference) || message === followUp ? [second, first] : [first];
      yield { type: 'tool_calls', toolCalls: recipients.map(({ id }) => send(`send_${turnId}_${id}`, { thread_id: id, message })) };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Handled.' };
    yield { type: 'done', finishReason: 'stop' };
  } };
  const toolHost = new ThreadMessageToolHost(threadStore, (threadId, input) => loop.deliverMailboxInput(threadId, input));
  const loop: AgentLoop = new AgentLoop({ threadStore, modelClient, clock: systemClock, ids, eventBus: new InMemoryEventBus(), toolHost });
  try {
    const original = `请发给 ${threadMentionText(first)}`;
    const retry = '再试一下';
    const switchRecipient = `改发给 ${newReference}`;
    await loop.sendTurn(source.id, { input: original });
    await loop.sendTurn(source.id, { input: retry });
    await loop.sendTurn(source.id, { input: switchRecipient });
    await loop.sendTurn(source.id, { input: followUp });

    expect((await threadStore.getThread(first.id))?.mailboxDeliveries?.map((message) => message.content)).toEqual([original, retry]);
    expect((await threadStore.getThread(second.id))?.mailboxDeliveries?.map((message) => message.content)).toEqual([switchRecipient, followUp]);
  } finally {
    await loop.shutdown();
  }
});

it('does not deliver an already consumed message again after context compaction', async () => {
  const ids = new RandomIdGenerator();
  const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
  const source = await threadStore.createThread({ title: 'Planning' });
  const recipient = await threadStore.createThread({ title: 'Review' });
  const modelClient = new MemoryCapturingModelClient();
  const loop = new AgentLoop({ threadStore, modelClient, ids, clock: systemClock, eventBus: new InMemoryEventBus() });
  const deliveryId = 'peer_report';
  try {
    const receipt = await loop.deliverMailboxInput(recipient.id, {
      id: deliveryId, content: 'An earlier report.', threadMessage: { from: { id: source.id, title: source.title } },
    });
    expect(receipt.turnId).toBeTruthy();
    await waitForTurnCompleted(threadStore, recipient.id, receipt.turnId!);
    for (let index = 0; index < 5; index += 1) {
      await loop.sendTurn(recipient.id, { input: `Review item ${index}.` });
    }

    const compacted = await loop.compactThreadContext(recipient.id);
    expect(compacted.messages.some((message) => message.id === threadMessageTranscriptId(deliveryId))).toBe(true);
    expect(compacted.messages.some((message) => message.id === mailboxMessageId(deliveryId))).toBe(false);

    await loop.sendTurn(recipient.id, { input: 'Continue the current review.' });
    expect(modelClient.requests.at(-1)?.messages.some((message) => message.id === mailboxMessageId(deliveryId))).toBe(false);
  } finally {
    await loop.shutdown();
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function send(id: string, args: Record<string, string | undefined>): RuntimeToolCall {
  return { id, name: 'send_thread_message', arguments: JSON.stringify(args) };
}
