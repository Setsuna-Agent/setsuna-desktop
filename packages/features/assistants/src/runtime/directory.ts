import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  assistantDraftCodec, isActiveTask, primaryAssistantConversation, type Assistant, type AssistantConnectorStatus, type AssistantConversation, type AssistantDraft,
  type AssistantPeerUpdate, type AssistantsRuntimeHost, type AssistantsSnapshot,
  type AssistantsState,
} from '../contracts/index.js';
import type { AssistantsStateStore } from './state-store.js';
import { AssistantConversations } from './conversations.js';

export const qqSecretKey = (assistantId: string) => `feature.assistants.${assistantId}.qq-secret`;

export function failure(code: string, message: string): FeatureOperationFailure {
  return new FeatureOperationFailure({ code, message, retryable: false });
}

export type AssistantDirectoryHooks = {
  connectorStatuses(): AssistantConnectorStatus[];
  /** Configuration or credentials changed; connectors reconcile in the background. */
  assistantChanged(assistantId: string): void;
};

/** Owns assistant configuration, their conversations and the QQ peers allowed to reach them. */
export class AssistantDirectory {
  private readonly conversations: AssistantConversations;
  constructor(
    private readonly host: AssistantsRuntimeHost,
    private readonly store: AssistantsStateStore,
    private readonly hooks: AssistantDirectoryHooks,
  ) { this.conversations = new AssistantConversations(host); }

  async snapshot(): Promise<AssistantsSnapshot> {
    await this.store.settled();
    // Capture committed state before loading catalogs, so a concurrent mutation cannot tear the view.
    const state = structuredClone(this.store.current);
    const [models, projects, summaries] = await Promise.all([
      this.host.listModels(), this.host.listProjects(), this.host.listConversationSummaries(),
    ]);
    const threads = new Map(summaries.map((thread) => [thread.id, thread]));
    return {
      assistants: state.assistants, peers: state.peers, tasks: state.tasks, reminders: state.reminders,
      // A transcript deleted elsewhere disappears here first; the deletion event prunes the record.
      conversations: state.assistants.flatMap((assistant) => {
        const item = primaryAssistantConversation(state.conversations, assistant.id);
        if (!item) return [];
        const thread = threads.get(item.threadId);
        const previousThreadIds = state.conversations.filter((entry) => entry.assistantId === assistant.id && entry.threadId !== item.threadId).map((entry) => entry.threadId);
        return thread ? [{ ...item, title: thread.title, updatedAt: thread.updatedAt,
          ...(previousThreadIds.length ? { previousThreadIds } : {}),
          ...(thread.activeTurnId ? { activeTurnId: thread.activeTurnId } : {}) }] : [];
      }),
      connectors: this.hooks.connectorStatuses(), models, projects,
    };
  }

  assistant(assistantId: string): Assistant | undefined {
    return this.store.current.assistants.find((item) => item.id === assistantId);
  }

  conversation(threadId: string): AssistantConversation | undefined {
    return this.store.current.conversations.find((item) => item.threadId === threadId);
  }

  /** Resolves the assistant identity of a conversation; other threads never get assistant tools. */
  assistantForThread(threadId: string): Assistant | undefined {
    const conversation = this.conversation(threadId);
    return conversation && !conversation.mergedInto ? this.assistant(conversation.assistantId) : undefined;
  }

  async create(input: AssistantDraft): Promise<Assistant> {
    const assistant = await this.store.mutate(async ({ state }) => {
      const draft = await this.validate(input, state);
      const now = this.host.now().toISOString();
      const created: Assistant = { ...draft, id: this.host.id('assistant'), createdAt: now, updatedAt: now };
      state.assistants.push(created);
      await this.conversations.ensure(state, created);
      return created;
    });
    this.hooks.assistantChanged(assistant.id);
    return structuredClone(assistant);
  }

  async update(assistantId: string, input: AssistantDraft): Promise<Assistant> {
    const assistant = await this.store.mutate(async ({ state }) => {
      const index = state.assistants.findIndex((item) => item.id === assistantId);
      if (index < 0) throw failure('ASSISTANT_NOT_FOUND', '助理不存在。');
      const previous = state.assistants[index]!;
      const draft = await this.validate(input, state, assistantId);
      const updated: Assistant = { ...draft, id: previous.id, createdAt: previous.createdAt, updatedAt: this.host.now().toISOString() };
      state.assistants[index] = updated;
      if (!sameModel(previous, updated)) {
        // Conversations keep their own binding; follow the assistant's model so every source answers alike.
        for (const conversation of state.conversations.filter((item) => item.assistantId === assistantId && !item.mergedInto)) {
          await this.host.updateConversationModel(conversation.threadId, updated.modelSelection);
        }
      }
      return updated;
    });
    this.hooks.assistantChanged(assistant.id);
    return structuredClone(assistant);
  }

  async delete(assistantId: string): Promise<{ deleted: boolean }> {
    const deleted = await this.store.mutate(async ({ state }) => {
      if (!state.assistants.some((item) => item.id === assistantId)) return false;
      if (state.tasks.some((task) => task.assistantId === assistantId && isActiveTask(task))) {
        throw failure('ASSISTANT_BUSY', '请先等待或取消助理正在进行的任务。');
      }
      const failures: unknown[] = [];
      for (const conversation of state.conversations.filter((item) => item.assistantId === assistantId)) {
        try {
          if (await this.host.getThreadInfo(conversation.threadId)) await this.host.deleteThread(conversation.threadId);
          state.conversations = state.conversations.filter((item) => item.threadId !== conversation.threadId);
        } catch (error) { failures.push(error); }
      }
      // Keep the assistant when a transcript survives, so its history stays reachable for a retry.
      if (failures.length) throw failures[0];
      const others = <T extends { assistantId: string }>(items: T[]) => items.filter((item) => item.assistantId !== assistantId);
      Object.assign(state, {
        assistants: state.assistants.filter((item) => item.id !== assistantId),
        peers: others(state.peers), tasks: others(state.tasks), reminders: others(state.reminders), deliveries: others(state.deliveries), inbox: others(state.inbox),
      } satisfies Partial<AssistantsState>);
      return true;
    });
    if (deleted) {
      await this.host.secrets.delete(qqSecretKey(assistantId)).catch(() => undefined);
      this.hooks.assistantChanged(assistantId);
    }
    return { deleted };
  }

  /** Every channel resumes this same transcript, including across restarts. */
  openConversation(assistantId: string): Promise<{ threadId: string }> {
    return this.store.mutate(async ({ state }) => {
      const assistant = state.assistants.find((item) => item.id === assistantId);
      if (!assistant) throw failure('ASSISTANT_NOT_FOUND', '助理不存在。');
      return { threadId: (await this.conversations.ensure(state, assistant)).threadId };
    });
  }

  async revealQqSecret(assistantId: string): Promise<{ secret: string | null }> {
    await this.store.settled();
    if (!this.assistant(assistantId)) throw failure('ASSISTANT_NOT_FOUND', '助理不存在。');
    return { secret: await this.host.secrets.get(qqSecretKey(assistantId)) ?? null };
  }

  async setQqSecret(assistantId: string, secret: string | null): Promise<{ configured: boolean }> {
    if (!this.assistant(assistantId)) throw failure('ASSISTANT_NOT_FOUND', '助理不存在。');
    if (secret === null) await this.host.secrets.delete(qqSecretKey(assistantId));
    else await this.host.secrets.set(qqSecretKey(assistantId), secret);
    this.hooks.assistantChanged(assistantId);
    return { configured: secret !== null };
  }

  async updatePeer(assistantId: string, update: AssistantPeerUpdate): Promise<AssistantsSnapshot> {
    await this.store.mutate(({ state }) => {
      const peer = state.peers.find((item) => item.assistantId === assistantId && item.kind === update.kind && item.openid === update.openid);
      if (!peer) throw failure('ASSISTANT_NOT_FOUND', 'QQ 会话不存在。');
      if (update.status === 'removed') {
        state.peers = state.peers.filter((item) => item !== peer);
        return;
      }
      peer.status = 'allowed';
    });
    return this.snapshot();
  }

  /** Called inside the same serialized transaction that records a QQ reply route. */
  async ensureConversation(state: AssistantsState, assistant: Assistant): Promise<string> {
    return (await this.conversations.ensure(state, assistant)).threadId;
  }

  async reconcileConversations(): Promise<void> {
    // Commit routing first, so a busy or failing history import cannot keep future messages split.
    await this.store.mutate(async ({ state }) => {
      for (const assistant of state.assistants) await this.conversations.ensure(state, assistant);
    });
    await this.store.mutate(({ state }) => this.conversations.reconcile(state));
  }

  hasPendingConversationHistory(): boolean {
    const state = this.store.current;
    return state.assistants.some((assistant) => state.conversations.filter((item) => item.assistantId === assistant.id && !item.mergedInto).length > 1);
  }

  /** Drops conversations whose transcript was deleted elsewhere. Must run inside a state mutation. */
  forgetThread(state: AssistantsState, threadId: string): boolean {
    if (!state.conversations.some((item) => item.threadId === threadId)) return false;
    state.conversations = state.conversations.filter((item) => item.threadId !== threadId);
    return true;
  }

  private async validate(input: AssistantDraft, state: AssistantsState, assistantId?: string): Promise<AssistantDraft> {
    const draft = assistantDraftCodec.parse(input);
    const [models, projects] = await Promise.all([this.host.listModels(), this.host.listProjects()]);
    if (draft.modelSelection) {
      const model = models.find((item) => item.providerId === draft.modelSelection?.providerId && item.modelId === draft.modelSelection?.modelId);
      if (!model) throw failure('INVALID_INPUT', '所选模型不可用，请重新选择。');
      if (draft.thinkingEffort && !model.thinkingEfforts.includes(draft.thinkingEffort)) throw failure('INVALID_INPUT', '模型不支持所选强度。');
    } else delete draft.thinkingEffort;
    const available = new Set(projects.map((project) => project.id));
    if (draft.projectIds.some((id) => !available.has(id))) throw failure('INVALID_INPUT', '部分授权项目已不存在，请重新选择。');
    if (draft.qq && state.assistants.some((item) => item.id !== assistantId && item.qq?.appId === draft.qq?.appId)) {
      throw failure('ASSISTANT_CONFLICT', '这个 QQ AppID 已绑定其他助理。');
    }
    return draft;
  }
}

function sameModel(left: Assistant, right: Assistant): boolean {
  return left.modelSelection?.providerId === right.modelSelection?.providerId && left.modelSelection?.modelId === right.modelSelection?.modelId;
}
