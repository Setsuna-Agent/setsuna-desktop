import {
  resolveWorkspaceConversationDefaults, type RuntimeMessage, type RuntimeThread, type RuntimeThreadSummary,
} from '@setsuna-desktop/contracts';
import type { AssistantsRuntimeHost, AssistantThreadInfo, AssistantWebSocket } from '@setsuna-desktop/feature-assistants/contracts';
import { resolveRuntimeModelReference, resolveRuntimeNextTurnModel } from '../loop/core/runtime-thread-model.js';
import type { ThreadStorePatch } from '../ports/thread-store.js';
import type { RuntimeContainer } from '../runtime/runtime-factory.js';
import { createRuntimeThread } from '../runtime/use-cases/thread-create.js';
import { deleteRuntimeThread } from '../runtime/use-cases/thread-operations.js';
import { isVisibleThreadMessage, visibleThreadMessageContent } from '../utils/thread-visible-messages.js';
import { mergeAssistantConversationHistory } from './assistants-history.js';

const FEATURE_ID = 'assistants';

function threadInfo(thread: RuntimeThreadSummary): AssistantThreadInfo {
  return {
    id: thread.id, title: thread.title, updatedAt: thread.updatedAt, archived: thread.archived,
    ...(thread.projectId ? { projectId: thread.projectId } : {}),
    // Worktree conversations have their own checkout; local ones share the project directory.
    workspaceKey: thread.workspaceId ? `workspace:${thread.workspaceId}` : thread.projectId ? `project:${thread.projectId}` : `thread:${thread.id}`,
    featureOwned: Boolean(thread.featureId) || thread.kind === 'side' || Boolean(thread.parentThreadId),
  };
}

/** The visible final answer of a turn; falls back to its last visible assistant text. */
function finalAnswer(thread: RuntimeThread, turnId: string): string | undefined {
  const replies = thread.messages.filter((message): message is RuntimeMessage => message.role === 'assistant'
    && message.turnId === turnId && isVisibleThreadMessage(message));
  const text = (message: RuntimeMessage | undefined) => message ? visibleThreadMessageContent(message).trim() : '';
  return text(replies.filter((message) => message.phase === 'final_answer').at(-1))
    || text(replies.filter((message) => text(message)).at(-1)) || undefined;
}

/** Node's WebSocket, narrowed to the callbacks the QQ gateway uses. */
function openWebSocket(url: string): AssistantWebSocket {
  const socket = new WebSocket(url);
  const adapter: AssistantWebSocket = {
    send: (data) => { if (socket.readyState === WebSocket.OPEN) socket.send(data); },
    close: (code, reason) => socket.close(code, reason),
    onopen: null, onmessage: null, onclose: null, onerror: null,
  };
  socket.onopen = () => adapter.onopen?.();
  socket.onmessage = (event) => adapter.onmessage?.({ data: event.data });
  socket.onclose = (event) => adapter.onclose?.({ code: event.code, reason: event.reason });
  socket.onerror = (event) => adapter.onerror?.(event);
  return adapter;
}

export function createAssistantsRuntimeHost(runtime: RuntimeContainer): AssistantsRuntimeHost {
  const fetchImpl = runtime.networkProxyFetch.forRoute();
  const getThread = (threadId: string) => runtime.threadStore.getThread(threadId);
  const resolveModel = async (reference: Parameters<typeof resolveRuntimeModelReference>[1]) => (
    resolveRuntimeModelReference(await runtime.configStore.getConfig(), reference).binding
  );
  return {
    dataDir: runtime.dataDir,
    now: () => runtime.clock.now(),
    id: (prefix) => runtime.ids.id(prefix),
    async listProjects() {
      const { projects } = await runtime.workspaceProjects.listProjects();
      return projects.filter((project) => project.path && !project.archivedAt)
        .map((project) => ({ id: project.id, name: project.name, path: project.path!, git: Boolean(project.gitRoot),
          ...(project.icon ? { icon: project.icon } : {}) }));
    },
    async listModels() {
      const config = await runtime.configStore.getConfig();
      return config.providers.filter((provider) => provider.enabled).flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => ({
        providerId: provider.id, modelId: model.id, name: `${model.name} · ${provider.name}`,
        thinkingEfforts: model.thinkingEnabled ? model.thinkingEfforts : [],
      })));
    },
    async createConversation({ title, modelSelection }) {
      const thread = await runtime.threadStore.createThread({
        title, memoryMode: 'disabled', featureId: FEATURE_ID,
        ...(modelSelection ? { modelBinding: await resolveModel(modelSelection) } : {}),
      });
      return thread.id;
    },
    async updateConversationModel(threadId, modelSelection) {
      const thread = await getThread(threadId);
      if (!thread) return;
      const binding = modelSelection ? await resolveModel(modelSelection)
        : resolveRuntimeNextTurnModel(await runtime.configStore.getConfig(), { ...thread, modelBinding: undefined, messages: [] })?.binding;
      if (binding) await runtime.threadStore.updateThread(threadId, { modelBinding: binding });
    },
    deleteThread: (threadId, options) => deleteRuntimeThread(runtime, threadId, options),
    mergeConversationHistory: (source, destination) => mergeAssistantConversationHistory(runtime, source, destination),
    async listConversationSummaries() {
      const threads = await runtime.threadStore.listThreads({ includeFeatures: true });
      return threads.filter((thread) => thread.featureId === FEATURE_ID)
        .map((thread) => {
          const activeTurnId = runtime.agentLoop.activeTurnId(thread.id);
          return { id: thread.id, title: thread.title, updatedAt: thread.updatedAt, ...(activeTurnId ? { activeTurnId } : {}) };
        });
    },
    async getThreadInfo(threadId) {
      const thread = await getThread(threadId);
      const activeTurnId = runtime.agentLoop.activeTurnId(threadId);
      return thread ? { ...threadInfo(thread), ...(activeTurnId ? { activeTurnId } : {}) } : null;
    },
    async searchThreads({ projectIds, query, limit }) {
      const groups = await Promise.all(projectIds.map((projectId) => runtime.threadStore.listThreads({
        projectId, scope: 'project', ...(query ? { search: query } : {}),
      })));
      return groups.flat().filter((thread) => !thread.archived && !thread.featureId && thread.kind !== 'side' && !thread.parentThreadId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit).map(threadInfo);
    },
    async readThreadMessages(threadId, limit) {
      const page = await runtime.threadStore.listMessages(threadId, { limit });
      return page.messages.filter((message) => isVisibleThreadMessage(message) && (message.role === 'user' || message.role === 'assistant'))
        .map((message) => ({ role: message.role as 'user' | 'assistant', content: visibleThreadMessageContent(message), createdAt: message.createdAt }));
    },
    async createWorkThread({ title, projectId, worktree, taskId, modelSelection }) {
      // Resolve the selected model before creating a conversation or worktree. A stale default must
      // fail explicitly, not silently run the task with another model or leave an orphan checkout.
      const { projects } = await runtime.workspaceProjects.listProjects();
      const defaults = resolveWorkspaceConversationDefaults(projects.find((project) => project.id === projectId), projects);
      const patch: ThreadStorePatch = { origin: { featureId: FEATURE_ID, entityId: taskId } };
      const model = modelSelection ?? defaults?.model;
      if (model) patch.modelBinding = await resolveModel(model);
      const thread = await createRuntimeThread(runtime, { title, projectId, workspaceMode: worktree ? 'worktree' : 'local' });
      return threadInfo(await runtime.threadStore.updateThread(thread.id, patch));
    },
    async startTurn(threadId, { input, clientId, modelSelection, thinkingEffort }) {
      const response = await runtime.agentLoop.startTurn(threadId, {
        input, ...(clientId ? { clientId } : {}), ...(modelSelection ? { modelSelection } : {}),
        ...(thinkingEffort ? { thinking: true, thinkingEffort } : {}),
      });
      return {
        ...(response.turnId ? { turnId: response.turnId } : {}),
        ...('queuedInputId' in response && response.queuedInputId ? { queuedInputId: response.queuedInputId } : {}),
      };
    },
    async steerTurn(threadId, turnId, input) {
      await runtime.agentLoop.steerTurn(threadId, { input, expectedTurnId: turnId });
    },
    async cancelTurn(threadId, turnId) {
      await runtime.agentLoop.cancelTurn(threadId, turnId);
    },
    async deleteQueuedInput(threadId, inputId) {
      const thread = await getThread(threadId);
      if (!thread?.queuedTurnInputs?.some((item) => item.id === inputId)) return false;
      await runtime.agentLoop.deleteQueuedTurnInput(threadId, inputId);
      return true;
    },
    async locateInput(threadId, { clientId, queuedInputId }) {
      const thread = await getThread(threadId);
      if (!thread) return { state: 'missing' };
      if (thread.queuedTurnInputs?.some((item) => item.id === queuedInputId || item.clientId === clientId)) return { state: 'queued' };
      const message = thread.messages.find((item) => item.role === 'user' && item.clientId === clientId && item.turnId);
      return message?.turnId ? { state: 'started', turnId: message.turnId } : { state: 'missing' };
    },
    async turnOutcome(threadId, turnId) {
      const thread = await getThread(threadId);
      if (!thread) return { status: 'missing' };
      const turn = thread.turns?.find((item) => item.id === turnId);
      if (turn?.status === 'completed' || turn?.status === 'failed' || turn?.status === 'cancelled') {
        const answer = finalAnswer(thread, turnId);
        return { status: turn.status, ...(turn.error ? { error: turn.error } : {}), ...(answer ? { finalAnswer: answer } : {}) };
      }
      if (runtime.agentLoop.activeTurnId(threadId) === turnId) return { status: 'running' };
      // An unfinished record without a live task means the runtime stopped underneath it.
      return { status: turn ? 'interrupted' : 'missing' };
    },
    async listApprovals() {
      return (await runtime.approvalGate.listApprovals()).approvals;
    },
    async answerApproval(approvalId, answer) {
      const approval = (await runtime.approvalGate.listApprovals()).approvals.find((item) => item.id === approvalId && item.status === 'pending');
      if (!approval) throw new Error('The request is no longer pending.');
      await runtime.approvalGate.answerApproval(approvalId, approval.userInput
        ? { decision: 'approve', userInputResponse: { action: answer.action ?? 'decline', ...(answer.values ? { values: answer.values } : {}) }, ...(answer.message ? { message: answer.message } : {}) }
        : { decision: answer.decision ?? 'reject', ...(answer.message ? { message: answer.message } : {}) });
    },
    async deliverMailbox(threadId, { id, content, fromThreadId, thinkingEffort }) {
      const response = await runtime.agentLoop.deliverIdleMailboxInput(threadId, {
        id, content, deliveryMode: 'trigger_turn', triggerTurn: true, ...(fromThreadId ? { fromThreadId } : {}),
      }, thinkingEffort === undefined ? {} : { thinking: Boolean(thinkingEffort), thinkingEffort });
      return { turnId: response?.turnId ?? null };
    },
    subscribeEvents: (listener) => runtime.eventBus.subscribeAll(listener),
    secrets: {
      get: (key) => runtime.nativeBridge.get(key),
      set: (key, value) => runtime.nativeBridge.set(key, value),
      delete: (key) => runtime.nativeBridge.delete(key),
    },
    fetch: (input, init) => fetchImpl(input, init),
    openWebSocket,
  };
}
