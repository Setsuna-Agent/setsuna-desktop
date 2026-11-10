import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, vi } from 'vitest';
import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { AssistantsRuntimeHost, AssistantThreadInfo, AssistantTurnOutcome } from '../../src/contracts/index.js';
import { AssistantAccess } from '../../src/runtime/access.js';
import { AssistantDeliveryOutbox } from '../../src/runtime/deliveries.js';
import { AssistantDirectory } from '../../src/runtime/directory.js';
import { AssistantsStateStore } from '../../src/runtime/state-store.js';
import { AssistantTaskCoordinator } from '../../src/runtime/tasks.js';
import { AssistantTools } from '../../src/runtime/tools.js';
import { AssistantReminders } from '../../src/runtime/reminders.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

export async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'setsuna-assistants-'));
  let sequence = 0;
  let now = new Date('2026-10-01T00:00:00Z');
  const id = (prefix: string) => `${prefix}_${++sequence}`;
  const threads = new Map<string, AssistantThreadInfo>();
  const outcomes = new Map<string, AssistantTurnOutcome>();
  const secrets = new Map<string, string>();
  const listeners = new Set<(event: StoredThreadEvent) => void>();
  const host: AssistantsRuntimeHost = {
    dataDir, id, now: () => now,
    listProjects: async () => [{ id: 'project', name: '工程', path: '/projects/app', git: true }],
    listModels: async () => [{ providerId: 'provider', modelId: 'model', name: '模型', thinkingEfforts: ['high'] }],
    createConversation: vi.fn(async ({ title }) => {
      const threadId = id('conversation');
      threads.set(threadId, { id: threadId, title, workspaceKey: threadId, featureOwned: true, archived: false, updatedAt: now.toISOString() });
      return threadId;
    }),
    updateConversationModel: vi.fn(async () => undefined),
    mergeConversationHistory: vi.fn(async (source) => {
      const thread = threads.get(source);
      if (thread) threads.set(source, { ...thread, archived: true });
      return true;
    }),
    deleteThread: vi.fn(async (threadId) => { threads.delete(threadId); }),
    listConversationSummaries: async () => [...threads.values()],
    getThreadInfo: async (threadId) => threads.get(threadId) ?? null,
    searchThreads: async ({ projectIds }) => [...threads.values()].filter((thread) => projectIds.includes(thread.projectId ?? '')),
    readThreadMessages: vi.fn(async () => [{ role: 'assistant' as const, content: '项目中的工作记录', createdAt: now.toISOString() }]),
    createWorkThread: vi.fn(async ({ title, projectId, worktree }) => {
      const threadId = id('work');
      const thread: AssistantThreadInfo = { id: threadId, title, projectId, workspaceKey: worktree ? id('worktree') : 'project', featureOwned: false, archived: false, updatedAt: now.toISOString() };
      threads.set(threadId, thread);
      return thread;
    }),
    startTurn: vi.fn(async () => { const turnId = id('turn'); outcomes.set(turnId, { status: 'running' }); return { turnId }; }),
    steerTurn: vi.fn(async () => undefined), cancelTurn: vi.fn(async () => undefined),
    deleteQueuedInput: vi.fn(async () => true), locateInput: vi.fn(async () => ({ state: 'missing' as const })),
    turnOutcome: async (_threadId, turnId) => outcomes.get(turnId) ?? { status: 'missing' },
    listApprovals: async () => [], answerApproval: vi.fn(async () => undefined),
    deliverMailbox: vi.fn(async () => ({ turnId: id('report_turn') })),
    subscribeEvents: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    secrets: {
      get: async (key) => secrets.get(key),
      set: async (key, value) => { secrets.set(key, value); },
      delete: async (key) => { secrets.delete(key); },
    },
    fetch: vi.fn(async (url) => Response.json(url.includes('getAppAccessToken') ? { access_token: 'test-token', expires_in: 7200 } : { url: 'wss://gateway.test' })),
    openWebSocket: () => { throw new Error('QQ socket must be provided by the test.'); },
  };
  const store = new AssistantsStateStore(dataDir);
  await store.load();
  const directory = new AssistantDirectory(host, store, { connectorStatuses: () => [], assistantChanged: () => undefined });
  const access = new AssistantAccess(host);
  const errors = vi.fn();
  const outbox = new AssistantDeliveryOutbox(host, store, errors);
  const tasks = new AssistantTaskCoordinator(host, store, access, outbox, errors);
  const reminders = new AssistantReminders(host, store, directory, outbox, errors);
  const tools = new AssistantTools(host, directory, access, tasks, outbox, reminders);
  cleanup.push(async () => { reminders.dispose(); tasks.dispose(); outbox.dispose(); await store.dispose(); await rm(dataDir, { recursive: true, force: true }); });
  const assistant = await directory.create({ name: '协作助理', personality: '先核实再执行', projectIds: ['project'] });
  const conversation = await directory.openConversation(assistant.id);
  return {
    host, store, directory, access, outbox, tasks, reminders, tools, errors, assistant, conversation, outcomes, threads,
    file: path.join(dataDir, 'features', 'assistants', 'state.json'),
    advance(ms: number) { now = new Date(now.getTime() + ms); },
    emit(event: StoredThreadEvent) { for (const listener of listeners) listener(event); tasks.handleEvent(event); outbox.handleEvent(event); },
  };
}

export function completed(threadId: string, turnId: string): StoredThreadEvent {
  return { id: `event_${turnId}`, seq: 1, threadId, turnId, createdAt: '2026-10-01T00:00:00Z', type: 'turn.completed', payload: {} };
}
