import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createOpenAiDynamicToolServer,
} from '../../support/runtime-server/app-server-steering.js';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import {
  createDelayedOpenAiCaptureServer,
  withTimeout
} from '../../support/runtime-server/shared.js';

describe('runtime server AppServer steering and dynamic tools', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('steers additional AppServer user input into the active turn', async () => {
      const capture = await createDelayedOpenAiCaptureServer();
      try {
        await harness.runtimeFetch('/v1/config', {
          method: 'PUT',
          body: JSON.stringify({
            activeProviderId: 'steer-provider',
            providers: [
              {
                id: 'steer-provider',
                name: 'Steer provider',
                provider: 'openai-compatible',
                baseUrl: capture.baseUrl,
                apiKey: 'sk-steer',
                enabled: true,
                models: [
                  {
                    id: 'steer-model',
                    name: 'Steer model',
                    code: 'steer-model',
                    enabled: true,
                    maxOutputTokens: 1000,
                    thinkingEnabled: false,
                    thinkingEfforts: [],
                  },
                ],
              },
            ],
          }),
        });
        const startedThread = await harness.appServerRpc('thread/start', { name: 'Steer active AppServer turn', cwd: process.cwd() });
        const startedTurn = await harness.appServerRpc('turn/start', {
          threadId: startedThread.thread.id,
          clientUserMessageId: 'client-start-message-1',
          input: [{ type: 'text', text: 'Keep this turn active.' }],
        });
        await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for delayed provider request');
  
        await expect(harness.appServerRpc('turn/steer', {
          threadId: startedThread.thread.id,
          expectedTurnId: startedTurn.turn.id,
          clientUserMessageId: 'client-steer-message-1',
          input: [{ type: 'text', text: 'Steer this active turn.' }],
        })).resolves.toEqual({ turnId: startedTurn.turn.id });
  
        const beforeRelease = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(startedThread.thread.id)}`);
        expect(beforeRelease.messages.find((message: { clientId?: string }) => message.clientId === 'client-steer-message-1')).toMatchObject({
          content: 'Steer this active turn.',
          role: 'user',
          turnId: startedTurn.turn.id,
        });
        capture.release();
        const updated = await harness.waitForThread(
          startedThread.thread.id,
          (item) => item.messages.some((message) =>
            message.turnId === startedTurn.turn.id
            && message.role === 'user'
            && message.content === 'Steer this active turn.'
          ),
        );
        const hasSteeredItem = await harness.readEventStreamContains(
          startedThread.thread.id,
          0,
          '"clientId":"client-steer-message-1"',
          { format: 'swe' },
        );
        const read = await harness.appServerRpc('thread/read', { threadId: startedThread.thread.id, includeTurns: true });
        const activeTurn = read.thread.turns.find((turn: { id: string }) => turn.id === startedTurn.turn.id);
  
        expect(hasSteeredItem).toBe(true);
        expect(updated.messages.filter((message) => message.turnId === startedTurn.turn.id && message.role === 'user')).toHaveLength(2);
        expect(activeTurn?.items).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'userMessage',
            clientId: 'client-start-message-1',
            content: [{ type: 'text', text: 'Keep this turn active.' }],
          }),
          expect.objectContaining({
            type: 'userMessage',
            clientId: 'client-steer-message-1',
            content: [{ type: 'text', text: 'Steer this active turn.' }],
          }),
        ]));
      } finally {
        capture.release();
        await capture.close();
      }
    });
  
  it('delivers AppServer mailbox input into the active turn', async () => {
      const capture = await createDelayedOpenAiCaptureServer();
      try {
        await harness.runtimeFetch('/v1/config', {
          method: 'PUT',
          body: JSON.stringify({
            activeProviderId: 'mailbox-provider',
            providers: [
              {
                id: 'mailbox-provider',
                name: 'Mailbox provider',
                provider: 'openai-compatible',
                baseUrl: capture.baseUrl,
                apiKey: 'sk-mailbox',
                enabled: true,
                models: [
                  {
                    id: 'mailbox-model',
                    name: 'Mailbox model',
                    code: 'mailbox-model',
                    enabled: true,
                    maxOutputTokens: 1000,
                    thinkingEnabled: false,
                    thinkingEfforts: [],
                  },
                ],
              },
            ],
          }),
        });
        const startedThread = await harness.appServerRpc('thread/start', { name: 'Mailbox active AppServer turn', cwd: process.cwd() });
        const startedTurn = await harness.appServerRpc('turn/start', {
          threadId: startedThread.thread.id,
          clientUserMessageId: 'client-start-message-1',
          input: [{ type: 'text', text: 'Keep this turn active.' }],
        });
        await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for delayed provider request');
  
        await expect(harness.appServerRpc('turn/mailbox/deliver', {
          threadId: startedThread.thread.id,
          expectedTurnId: startedTurn.turn.id,
          id: 'mail_appserver_1',
          fromAgentId: 'agent_child',
          content: 'child agent found the app-server regression',
        })).resolves.toEqual({ queued: false, turnId: startedTurn.turn.id });
  
        const hasMailboxEvent = await harness.readEventStreamContains(
          startedThread.thread.id,
          0,
          '"type":"mailbox.delivered"',
        );
        const hasCollabItem = await harness.readEventStreamContains(
          startedThread.thread.id,
          0,
          '"type":"collabToolCall"',
          { format: 'swe' },
        );
        capture.release();
        const updated = await harness.waitForThread(startedThread.thread.id, (item) => item.activeTurnId === null);
  
        expect(hasMailboxEvent).toBe(true);
        expect(hasCollabItem).toBe(true);
        expect(updated.messages.filter((message) => message.turnId === startedTurn.turn.id && message.role === 'user')).toHaveLength(1);
      } finally {
        capture.release();
        await capture.close();
      }
    });
  
  it('starts an AppServer trigger-turn mailbox delivery when the thread is idle', async () => {
      const capture = await createDelayedOpenAiCaptureServer();
      try {
        await harness.configureOpenAiProvider('mailbox-trigger-provider', capture.baseUrl);
        const startedThread = await harness.appServerRpc('thread/start', { name: 'Mailbox trigger AppServer turn', cwd: process.cwd() });
  
        const delivered = await harness.appServerRpc('turn/mailbox/deliver', {
          threadId: startedThread.thread.id,
          id: 'mail_appserver_trigger_1',
          deliveryMode: 'trigger_turn',
          fromAgentId: 'agent_child',
          fromThreadId: 'thread_child',
          toAgentId: 'agent_parent',
          content: 'wake the idle app-server parent',
        });
        const body = await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for trigger mailbox provider request');
        const requestText = JSON.stringify(body);
  
        expect(delivered).toEqual({ queued: false, turnId: expect.any(String) });
        expect(requestText).toContain('mailbox_message');
        expect(requestText).toContain('mail_appserver_trigger_1');
        expect(requestText).toContain('wake the idle app-server parent');
        expect(requestText).toContain('trigger_turn');
  
        const hasMailboxEvent = await harness.readEventStreamContains(
          startedThread.thread.id,
          0,
          '"type":"mailbox.delivered"',
        );
        const hasCollabItem = await harness.readEventStreamContains(
          startedThread.thread.id,
          0,
          '"tool":"resume_agent"',
          { format: 'swe' },
        );
        capture.release();
        const updated = await harness.waitForThread(startedThread.thread.id, (item) => item.activeTurnId === null);
  
        expect(hasMailboxEvent).toBe(true);
        expect(hasCollabItem).toBe(true);
        expect(updated.messages.filter((message) => message.turnId === delivered.turnId && message.role === 'user')).toHaveLength(0);
      } finally {
        capture.release();
        await capture.close();
      }
    });
  
  it('routes AppServer dynamic tool calls through item/tool/call responses', async () => {
      const modelServer = await createOpenAiDynamicToolServer();
      const connectionId = 'dynamic-tool-session';
      await harness.appServerRpc('initialize', {
        clientInfo: { name: 'setsuna-dynamic-tool-test', version: 'test' },
        capabilities: { experimentalApi: true },
      }, { connectionId });
      const stream = await harness.openAppServerNotificationStream({ connectionId });
      try {
        await harness.configureOpenAiProvider('dynamic-tool-provider', modelServer.baseUrl);
        const startedThread = await harness.appServerRpc('thread/start', {
          name: 'Dynamic tool AppServer turn',
          cwd: process.cwd(),
          dynamicTools: [
            {
              name: 'tickets',
              description: 'Ticket tools.',
              tools: [
                {
                  name: 'lookup_ticket',
                  description: 'Look up a ticket by id.',
                  inputSchema: {
                    type: 'object',
                    properties: { id: { type: 'string' } },
                    required: ['id'],
                  },
                },
              ],
            },
          ],
        }, { connectionId });
  
        const startedTurn = await harness.appServerRpc('turn/start', {
          threadId: startedThread.thread.id,
          input: [{ type: 'text', text: 'Look up ticket ABC-123.' }],
        }, { connectionId });
        const request = await stream.readNotification((notification) => (
          notification.method === 'item/tool/call'
          && notification.params?.threadId === startedThread.thread.id
        ), { timeoutMs: 3000 });
  
        expect(request).toMatchObject({
          method: 'item/tool/call',
          id: expect.any(String),
          params: {
            threadId: startedThread.thread.id,
            turnId: startedTurn.turn.id,
            callId: 'call_dynamic_1',
            namespace: 'tickets',
            tool: 'lookup_ticket',
            arguments: { id: 'ABC-123' },
          },
        });
  
        await expect(harness.appServerRpcResponseEnvelope({
          id: request?.id,
          result: {
            contentItems: [{ type: 'inputText', text: 'Ticket ABC-123 is open.' }],
            success: true,
          },
        }, { connectionId })).resolves.toBeNull();
  
        const updated = await harness.waitForThread(
          startedThread.thread.id,
          (item) => item.messages.some((message) =>
            message.turnId === startedTurn.turn.id
            && message.role === 'assistant'
            && message.status === 'complete'
            && message.content.includes('Dynamic tool result received.')
          ),
        );
        const requests = await withTimeout(modelServer.requests, harness.providerCaptureTimeoutMs, 'Timed out waiting for dynamic tool model requests');
        const read = await harness.appServerRpc('thread/read', { threadId: startedThread.thread.id, includeTurns: true });
        const turn = read.thread.turns.find((item: { id: string }) => item.id === startedTurn.turn.id);
  
        expect(JSON.stringify(requests[0])).toContain('tickets__lookup_ticket');
        expect(JSON.stringify(requests[1])).toContain('Ticket ABC-123 is open.');
        expect(updated.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            role: 'tool',
            toolCallId: 'call_dynamic_1',
            toolName: 'tickets__lookup_ticket',
            content: 'Ticket ABC-123 is open.',
          }),
        ]));
        expect(turn?.items).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'dynamicToolCall',
            tool: 'tickets__lookup_ticket',
            contentItems: [{ type: 'inputText', text: 'Ticket ABC-123 is open.' }],
            success: true,
          }),
        ]));
      } finally {
        await stream.close();
        await modelServer.close();
      }
    });
  
  it('requires experimental AppServer capability for dynamic tools', async () => {
      await expect(harness.appServerRpcEnvelope({
        id: 'dynamic_tools_no_capability',
        method: 'thread/start',
        params: {
          name: 'Dynamic tool rejected',
          cwd: process.cwd(),
          dynamicTools: [{ name: 'lookup', description: 'Lookup.', inputSchema: { type: 'object' } }],
        },
      }, { connectionId: 'dynamic-tool-rejected-session' })).resolves.toMatchObject({
        id: 'dynamic_tools_no_capability',
        error: {
          code: -32600,
          message: 'dynamicTools requires initialize.params.capabilities.experimentalApi = true',
        },
      });
    });
  
  it('steers additional REST user input into the active turn', async () => {
      const capture = await createDelayedOpenAiCaptureServer();
      try {
        await harness.configureOpenAiProvider('rest-steer-provider', capture.baseUrl);
        const thread = await harness.runtimeFetch('/v1/threads', {
          method: 'POST',
          body: JSON.stringify({ title: 'REST steer active turn' }),
        });
        const started = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
          method: 'POST',
          body: JSON.stringify({ clientId: 'rest-start-message-1', input: 'Keep this REST turn active.' }),
        });
        await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for delayed REST provider request');
  
        const activeSnapshot = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`);
        expect(activeSnapshot.activeTurnId).toBe(started.turnId);
  
        await expect(harness.runtimeFetch(
          `/v1/threads/${encodeURIComponent(thread.id)}/turns/${encodeURIComponent(started.turnId)}/steer`,
          {
            method: 'POST',
            body: JSON.stringify({
              clientId: 'rest-steer-message-1',
              expectedTurnId: started.turnId,
              input: 'Steer this REST active turn.',
            }),
          },
        )).resolves.toEqual({ accepted: true, turnId: started.turnId });
  
        const beforeRelease = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`);
        expect(beforeRelease.messages.find((message: { clientId?: string }) => message.clientId === 'rest-steer-message-1')).toMatchObject({
          content: 'Steer this REST active turn.',
          role: 'user',
          turnId: started.turnId,
        });
        capture.release();
        const updated = await harness.waitForThread(
          thread.id,
          (item) => item.messages.some((message) =>
            message.turnId === started.turnId
            && message.role === 'user'
            && message.clientId === 'rest-steer-message-1'
          ),
        );
  
        expect(updated.messages.filter((message) => message.turnId === started.turnId && message.role === 'user')).toHaveLength(2);
        expect(updated.messages.find((message) => message.clientId === 'rest-steer-message-1')).toMatchObject({
          content: 'Steer this REST active turn.',
          role: 'user',
          turnId: started.turnId,
        });
      } finally {
        capture.release();
        await capture.close();
      }
    });
  
  it('treats REST turn starts during an active conversation as steering the active turn', async () => {
      const capture = await createDelayedOpenAiCaptureServer();
      try {
        await harness.configureOpenAiProvider('rest-start-steer-provider', capture.baseUrl);
        const thread = await harness.runtimeFetch('/v1/threads', {
          method: 'POST',
          body: JSON.stringify({ title: 'REST start while active' }),
        });
        const started = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
          method: 'POST',
          body: JSON.stringify({ clientId: 'rest-start-active-1', input: 'Keep this REST turn active.' }),
        });
        await withTimeout(capture.nextBody, harness.providerCaptureTimeoutMs, 'Timed out waiting for delayed REST provider request');
  
        await expect(harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, {
          method: 'POST',
          body: JSON.stringify({
            clientId: 'rest-start-while-active-steer',
            input: 'This should stay in the current turn.',
          }),
        })).resolves.toEqual({ accepted: true, turnId: started.turnId });
  
        const beforeRelease = await harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`);
        expect(beforeRelease.activeTurnId).toBe(started.turnId);
        expect(beforeRelease.messages.find((message: { clientId?: string }) => message.clientId === 'rest-start-while-active-steer')).toMatchObject({
          content: 'This should stay in the current turn.',
          role: 'user',
          turnId: started.turnId,
        });
  
        capture.release();
        const updated = await harness.waitForThread(
          thread.id,
          (item) => item.activeTurnId === null
            && item.messages.some((message) =>
              message.turnId === started.turnId
              && message.role === 'user'
              && message.clientId === 'rest-start-while-active-steer'
            ),
        );
  
        expect(updated.messages.filter((message) => message.turnId === started.turnId && message.role === 'user')).toHaveLength(2);
      } finally {
        capture.release();
        await capture.close();
      }
    });
  
  it('rejects AppServer turn steering without a matching active turn', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'No active steer', cwd: process.cwd() });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'steer_without_active_turn',
        method: 'turn/steer',
        params: {
          threadId: startedThread.thread.id,
          expectedTurnId: 'turn-does-not-exist',
          input: [{ type: 'text', text: 'No active turn.' }],
        },
      })).resolves.toMatchObject({
        id: 'steer_without_active_turn',
        error: { code: -32600, message: 'no active turn to steer' },
      });
    });
});
