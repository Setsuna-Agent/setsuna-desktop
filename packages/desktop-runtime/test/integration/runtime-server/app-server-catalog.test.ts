import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

describe('runtime server AppServer catalog and thread listing', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('accepts AppServer app-server JSON-RPC shaped requests for the SWE path', async () => {
      const initialized = await harness.appServerRpc('initialize', {
        clientInfo: { name: 'setsuna-test', version: 'test' },
        capabilities: null,
      });
      expect(initialized).toMatchObject({
        userAgent: 'setsuna-desktop/test',
        platformOs: expect.any(String),
        platformFamily: expect.any(String),
      });
  
      const startedThread = await harness.appServerRpc('thread/start', { name: 'AppServer RPC thread', cwd: process.cwd() });
      expect(startedThread).toMatchObject({
        thread: {
          id: expect.any(String),
          name: 'AppServer RPC thread',
          status: { type: 'idle' },
          source: 'appServer',
          turns: [],
        },
        approvalPolicy: expect.anything(),
        sandbox: expect.objectContaining({ type: expect.any(String) }),
      });
  
      await expect(harness.appServerRpc('thread/name/set', {
        threadId: startedThread.thread.id,
        name: 'Renamed AppServer RPC thread',
      })).resolves.toEqual({});
      await expect(harness.appServerRpc('thread/compact/start', {
        threadId: startedThread.thread.id,
      })).resolves.toEqual({});
  
      const renamed = await harness.appServerRpc('thread/read', { threadId: startedThread.thread.id });
      expect(renamed.thread).toMatchObject({
        id: startedThread.thread.id,
        name: 'Renamed AppServer RPC thread',
      });
  
      await expect(harness.appServerRpc('thread/archive', { threadId: startedThread.thread.id })).resolves.toEqual({});
      const hiddenArchived = await harness.appServerRpc('thread/list', {});
      expect(hiddenArchived.data.some((thread: { id: string }) => thread.id === startedThread.thread.id)).toBe(false);
      const listedArchived = await harness.appServerRpc('thread/list', { archived: true });
      expect(listedArchived).toMatchObject({
        data: [expect.objectContaining({ id: startedThread.thread.id, name: 'Renamed AppServer RPC thread' })],
        nextCursor: null,
      });
  
      const unarchived = await harness.appServerRpc('thread/unarchive', { threadId: startedThread.thread.id });
      expect(unarchived.thread).toMatchObject({
        id: startedThread.thread.id,
        name: 'Renamed AppServer RPC thread',
        status: { type: 'idle' },
      });
      const listed = await harness.appServerRpc('thread/list', {});
      expect(listed).toMatchObject({
        data: [expect.objectContaining({ id: startedThread.thread.id, name: 'Renamed AppServer RPC thread' })],
        nextCursor: null,
      });
  
      await expect(harness.readEventStreamContains(
        startedThread.thread.id,
        0,
        '"method":"thread/name/updated"',
        { format: 'swe' },
      )).resolves.toBe(true);
      await expect(harness.readEventStreamContains(
        startedThread.thread.id,
        0,
        '"method":"thread/archived"',
        { format: 'swe' },
      )).resolves.toBe(true);
      await expect(harness.readEventStreamContains(
        startedThread.thread.id,
        0,
        '"method":"thread/unarchived"',
        { format: 'swe' },
      )).resolves.toBe(true);
  
      const resumed = await harness.appServerRpc('thread/resume', { threadId: startedThread.thread.id });
      expect(resumed).toMatchObject({
        thread: {
          id: startedThread.thread.id,
          status: { type: 'idle' },
        },
        model: expect.any(String),
        sandbox: expect.objectContaining({ type: expect.any(String) }),
      });
  
      const startedTurn = await harness.appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        input: [{ type: 'text', text: 'Write a local smoke response.' }],
      });
      expect(startedTurn).toMatchObject({
        turn: {
          id: expect.any(String),
          status: 'inProgress',
          items: [],
        },
      });
  
      await harness.waitForThread(
        startedThread.thread.id,
        (item) => item.messages.some((message) => message.turnId === startedTurn.turn.id && message.role === 'assistant' && message.status === 'complete'),
      );
      const read = await harness.appServerRpc('thread/read', { threadId: startedThread.thread.id, includeTurns: true });
      expect(read.thread.turns).toEqual([expect.objectContaining({
        id: startedTurn.turn.id,
        items: expect.arrayContaining([
          expect.objectContaining({ type: 'userMessage' }),
          expect.objectContaining({ type: 'agentMessage' }),
        ]),
      })]);
      const resumedWithTurns = await harness.appServerRpc('thread/resume', { threadId: startedThread.thread.id });
      expect(resumedWithTurns.thread.turns).toEqual([expect.objectContaining({
        id: startedTurn.turn.id,
        items: expect.arrayContaining([
          expect.objectContaining({ type: 'userMessage' }),
          expect.objectContaining({ type: 'agentMessage' }),
        ]),
      })]);
      const resumedWithoutTurns = await harness.appServerRpc('thread/resume', { threadId: startedThread.thread.id, excludeTurns: true });
      expect(resumedWithoutTurns.thread.turns).toEqual([]);
  
      const forked = await harness.appServerRpc('thread/fork', {
        threadId: startedThread.thread.id,
        name: 'Forked AppServer RPC thread',
      });
      expect(forked.thread).toMatchObject({
        name: 'Forked AppServer RPC thread',
        forkedFromId: startedThread.thread.id,
        status: { type: 'idle' },
      });
      expect(forked.thread.turns).toEqual([expect.objectContaining({
        id: startedTurn.turn.id,
        items: expect.arrayContaining([
          expect.objectContaining({ type: 'userMessage' }),
          expect.objectContaining({ type: 'agentMessage' }),
        ]),
      })]);
    });
  
  it('lists loaded AppServer threads with cursor pagination', async () => {
      const firstThread = await harness.appServerRpc('thread/start', { name: 'Loaded A', cwd: process.cwd() });
      const secondThread = await harness.appServerRpc('thread/start', { name: 'Loaded B', cwd: process.cwd() });
      const expectedIds = [firstThread.thread.id, secondThread.thread.id].sort();
  
      await expect(harness.appServerRpc('thread/loaded/list', {})).resolves.toEqual({
        data: expectedIds,
        nextCursor: null,
      });
  
      const firstPage = await harness.appServerRpc('thread/loaded/list', { limit: 1 });
      expect(firstPage).toEqual({
        data: [expectedIds[0]],
        nextCursor: expectedIds[0],
      });
      await expect(harness.appServerRpc('thread/loaded/list', { cursor: firstPage.nextCursor, limit: 1 })).resolves.toEqual({
        data: [expectedIds[1]],
        nextCursor: null,
      });
    });
  
  it('lists AppServer turns in upstream page order and supports initial resume pages', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Paged turns', cwd: process.cwd() });
      const firstTurn = await harness.appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        input: [{ type: 'text', text: 'First paged turn.' }],
      });
      await harness.waitForThread(
        startedThread.thread.id,
        (item) => item.messages.some((message) => message.turnId === firstTurn.turn.id && message.role === 'assistant' && message.status === 'complete'),
      );
      const secondTurn = await harness.appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        input: [{ type: 'text', text: 'Second paged turn.' }],
      });
      await harness.waitForThread(
        startedThread.thread.id,
        (item) => item.messages.some((message) => message.turnId === secondTurn.turn.id && message.role === 'assistant' && message.status === 'complete'),
      );
  
      const newestPage = await harness.appServerRpc('thread/turns/list', {
        threadId: startedThread.thread.id,
        limit: 1,
      });
      expect(newestPage).toMatchObject({
        data: [
          {
            id: secondTurn.turn.id,
            itemsView: 'summary',
            items: [
              expect.objectContaining({ type: 'userMessage' }),
              expect.objectContaining({ type: 'agentMessage' }),
            ],
          },
        ],
        backwardsCursor: expect.any(String),
        nextCursor: expect.any(String),
      });
      expect(JSON.parse(newestPage.nextCursor)).toEqual({ turnId: secondTurn.turn.id, includeAnchor: false });
      expect(JSON.parse(newestPage.backwardsCursor)).toEqual({ turnId: secondTurn.turn.id, includeAnchor: true });
  
      const olderPage = await harness.appServerRpc('thread/turns/list', {
        threadId: startedThread.thread.id,
        cursor: newestPage.nextCursor,
        limit: 1,
      });
      expect(olderPage).toMatchObject({
        data: [expect.objectContaining({ id: firstTurn.turn.id, itemsView: 'summary' })],
        nextCursor: null,
        backwardsCursor: expect.any(String),
      });
  
      await expect(harness.appServerRpc('thread/turns/list', {
        threadId: startedThread.thread.id,
        sortDirection: 'asc',
        itemsView: 'notLoaded',
        limit: 2,
      })).resolves.toMatchObject({
        data: [
          { id: firstTurn.turn.id, items: [], itemsView: 'notLoaded' },
          { id: secondTurn.turn.id, items: [], itemsView: 'notLoaded' },
        ],
        nextCursor: null,
      });
  
      const resumed = await harness.appServerRpc('thread/resume', {
        threadId: startedThread.thread.id,
        excludeTurns: true,
        initialTurnsPage: { limit: 1, sortDirection: 'asc', itemsView: 'notLoaded' },
      });
      expect(resumed.thread.turns).toEqual([]);
      expect(resumed.initialTurnsPage).toMatchObject({
        data: [{ id: firstTurn.turn.id, items: [], itemsView: 'notLoaded' }],
        nextCursor: expect.any(String),
        backwardsCursor: expect.any(String),
      });
  
      const firstTurnFirstItem = await harness.appServerRpc('thread/items/list', {
        threadId: startedThread.thread.id,
        turnId: firstTurn.turn.id,
        limit: 1,
      });
      expect(firstTurnFirstItem).toMatchObject({
        data: [
          expect.objectContaining({
            type: 'userMessage',
            content: [{ type: 'text', text: 'First paged turn.' }],
          }),
        ],
        nextCursor: expect.any(String),
        backwardsCursor: expect.any(String),
      });
      expect(JSON.parse(firstTurnFirstItem.nextCursor)).toMatchObject({
        turnId: firstTurn.turn.id,
        includeAnchor: false,
      });
  
      const firstTurnRest = await harness.appServerRpc('thread/items/list', {
        threadId: startedThread.thread.id,
        turnId: firstTurn.turn.id,
        cursor: firstTurnFirstItem.nextCursor,
        limit: 10,
      });
      expect(firstTurnRest).toMatchObject({
        data: [expect.objectContaining({ type: 'agentMessage' })],
        nextCursor: null,
        backwardsCursor: expect.any(String),
      });
  
      await expect(harness.appServerRpc('thread/items/list', {
        threadId: startedThread.thread.id,
        limit: 1,
        sortDirection: 'desc',
      })).resolves.toMatchObject({
        data: [expect.objectContaining({ type: 'agentMessage' })],
        nextCursor: expect.any(String),
        backwardsCursor: expect.any(String),
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'bad_items_cursor',
        method: 'thread/items/list',
        params: { threadId: startedThread.thread.id, cursor: 'invalid' },
      })).resolves.toMatchObject({
        id: 'bad_items_cursor',
        error: { code: -32600, message: 'invalid cursor: invalid' },
      });
    });
  
  it('lists configured AppServer models with upstream catalog pagination', async () => {
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'catalog-openai',
          providers: [
            {
              id: 'catalog-openai',
              name: 'Catalog OpenAI',
              provider: 'openai-responses',
              baseUrl: 'https://api.openai.test/v1',
              apiKey: 'sk-catalog',
              enabled: true,
              models: [
                {
                  id: 'alpha',
                  name: 'GPT Alpha',
                  code: 'gpt-alpha',
                  enabled: true,
                  maxOutputTokens: 2000,
                  thinkingEnabled: true,
                  thinkingEfforts: ['low', 'high'],
                  defaultThinkingEffort: 'high',
                  supportsImages: true,
                },
                {
                  id: 'beta',
                  name: 'GPT Beta',
                  code: 'gpt-beta',
                  enabled: false,
                  maxOutputTokens: 2000,
                  thinkingEnabled: false,
                  thinkingEfforts: [],
                },
              ],
            },
          ],
        }),
      });
  
      await expect(harness.appServerRpc('model/list', { limit: 1 })).resolves.toEqual({
        data: [
          {
            id: 'catalog-openai:alpha',
            model: 'gpt-alpha',
            upgrade: null,
            upgradeInfo: null,
            availabilityNux: null,
            displayName: 'GPT Alpha',
            description: 'Provider: Catalog OpenAI',
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: 'low', description: 'Low' },
              { reasoningEffort: 'high', description: 'High' },
            ],
            defaultReasoningEffort: 'high',
            inputModalities: ['text', 'image'],
            supportsPersonality: false,
            additionalSpeedTiers: [],
            serviceTiers: [],
            defaultServiceTier: null,
            isDefault: true,
          },
        ],
        nextCursor: null,
      });
  
      await expect(harness.appServerRpc('model/list', { includeHidden: true, cursor: '1', limit: 1 })).resolves.toMatchObject({
        data: [
          {
            id: 'catalog-openai:beta',
            model: 'gpt-beta',
            hidden: true,
            defaultReasoningEffort: 'none',
            inputModalities: ['text'],
            isDefault: false,
          },
        ],
        nextCursor: null,
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'bad_model_cursor',
        method: 'model/list',
        params: { cursor: 'invalid' },
      })).resolves.toMatchObject({
        id: 'bad_model_cursor',
        error: { code: -32600, message: 'invalid cursor: invalid' },
      });
    });
  
  it('returns AppServer model provider capabilities for the active provider', async () => {
      await expect(harness.appServerRpc('modelProvider/capabilities/read', {})).resolves.toEqual({
        namespaceTools: true,
        imageGeneration: true,
        webSearch: true,
      });
  
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'anthropic-catalog',
          providers: [
            {
              id: 'anthropic-catalog',
              name: 'Anthropic Catalog',
              provider: 'anthropic',
              baseUrl: 'https://api.anthropic.test',
              apiKey: 'sk-ant',
              enabled: true,
              models: [
                {
                  id: 'claude',
                  name: 'Claude',
                  code: 'claude-test',
                  enabled: true,
                  maxOutputTokens: 2000,
                  thinkingEnabled: false,
                  thinkingEfforts: [],
                },
              ],
            },
          ],
        }),
      });
  
      await expect(harness.appServerRpc('modelProvider/capabilities/read', {})).resolves.toEqual({
        namespaceTools: true,
        imageGeneration: false,
        webSearch: false,
      });
    });
  
  it('lists AppServer permission profiles with upstream ids and cursor pagination', async () => {
      await expect(harness.appServerRpc('permissionProfile/list', { limit: 2, cwd: process.cwd() })).resolves.toEqual({
        data: [
          { id: ':read-only', description: null, allowed: true },
          { id: ':workspace', description: null, allowed: true },
        ],
        nextCursor: '2',
      });
  
      await expect(harness.appServerRpc('permissionProfile/list', { cursor: '2', limit: 2 })).resolves.toEqual({
        data: [
          { id: ':danger-full-access', description: null, allowed: true },
        ],
        nextCursor: null,
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'bad_permission_cursor',
        method: 'permissionProfile/list',
        params: { cursor: 'NaN' },
      })).resolves.toMatchObject({
        id: 'bad_permission_cursor',
        error: { code: -32600, message: 'invalid cursor: NaN' },
      });
    });
});
