import type { AutomationRuntimeHost } from '@setsuna-desktop/feature-automation/contracts';
import type { RuntimeContainer } from '../runtime/runtime-factory.js';
import { resolveRuntimeNextTurnModel } from '../loop/core/runtime-thread-model.js';
import { reconcileAutomationConversations } from './automation/automation-conversation-migration.js';

export function createAutomationRuntimeHost(runtime: RuntimeContainer): AutomationRuntimeHost {
  return {
    dataDir: runtime.dataDir, now: () => runtime.clock.now(), id: (prefix) => runtime.ids.id(prefix),
    reconcileConversationOwnership: (state, instructions) => reconcileAutomationConversations(runtime, state, instructions),
    async canReuseConversation(threadId) {
      const thread = await runtime.threadStore.getThread(threadId);
      return Boolean(thread?.featureId === 'automation' && !thread.activeTurnId && !thread.turns?.length
        && !thread.queuedTurnInputs?.length && !thread.messages.some((message) => message.role === 'user'));
    },
    async createConversation(instructions) {
      const thread = await runtime.threadStore.createThread({ title: '新建定时任务', memoryMode: 'disabled', featureId: 'automation' });
      await runtime.eventWriter.append(thread.id, {
        id: runtime.ids.id('event'), threadId: thread.id, type: 'message.created', createdAt: runtime.clock.now().toISOString(),
        payload: { message: {
          id: runtime.ids.id('msg'), role: 'developer', visibility: 'model', status: 'complete',
          createdAt: runtime.clock.now().toISOString(), content: instructions,
        } },
      });
      return thread.id;
    },
    async createExecutionThread(task) {
      const source = await runtime.threadStore.getThread(task.conversationThreadId);
      if (!source) throw new Error('任务的来源对话已被删除，请重新创建任务。');
      const thread = await runtime.threadStore.createThread({
        title: task.title, projectId: task.projectId ?? undefined,
        workspaceId: task.projectId === source.projectId ? source.workspaceId : undefined,
        memoryMode: 'disabled', origin: { featureId: 'automation', entityId: task.id },
      });
      return thread.id;
    },
    threadExists: async (threadId) => Boolean(await runtime.threadStore.getThread(threadId)),
    async resolveProject(threadId, projectId) {
      const selected = projectId === undefined ? (await runtime.threadStore.getThread(threadId))?.projectId : projectId;
      if (!selected) return null;
      const status = await runtime.workspaceProjects.getStatus(selected);
      if (!status.project || status.project.archivedAt || !status.exists || !status.readable) throw new Error('任务项目不可用，请重新选择项目。');
      return status.project.id;
    },
    async listProjects() {
      const { projects } = await runtime.workspaceProjects.listProjects();
      return projects.filter((project) => project.path).map(({ id, name, path }) => ({ id, name, path }));
    },
    async listModels() {
      const config = await runtime.configStore.getConfig();
      // model.enabled selects the provider's default; all its configured models remain available.
      return config.providers.filter((provider) => provider.enabled).flatMap((provider) => provider.models.map((model) => ({
        providerId: provider.id, modelId: model.id, name: `${model.name} · ${provider.name}`,
        thinkingEfforts: model.thinkingEnabled ? model.thinkingEfforts : [],
      })));
    },
    async defaultModel(threadId) {
      const thread = await runtime.threadStore.getThread(threadId);
      if (!thread) return undefined;
      const selected = resolveRuntimeNextTurnModel(await runtime.configStore.getConfig(), thread);
      return selected ? { providerId: selected.binding.providerId, modelId: selected.binding.modelId } : undefined;
    },
    async startRun(threadId, input) {
      const response = await runtime.agentLoop.startTurn(threadId, input, { unattended: true });
      if (!response.turnId) throw new Error('Scheduled turn did not start.');
      return response.turnId;
    },
    async runStatus(run) {
      if (run.turnId && runtime.agentLoop.activeTurnId(run.threadId) === run.turnId) return { status: 'running' };
      const thread = await runtime.threadStore.getThread(run.threadId);
      const turn = thread?.turns?.find((item) => item.id === run.turnId);
      if (turn?.status === 'completed' || turn?.status === 'cancelled' || turn?.status === 'failed') return { status: turn.status, ...(turn.error ? { error: turn.error } : {}) };
      return { status: 'interrupted', error: thread ? '运行已停止。' : '运行对话已被删除。' };
    },
  };
}
