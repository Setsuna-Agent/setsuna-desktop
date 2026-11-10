import {
  primaryAssistantConversation, type Assistant, type AssistantConversation, type AssistantsRuntimeHost, type AssistantsState,
} from '../contracts/index.js';

/** Owns the assistant's single identity across desktop, private messages and groups. */
export class AssistantConversations {
  constructor(private readonly host: AssistantsRuntimeHost) {}

  async ensure(state: AssistantsState, assistant: Assistant): Promise<AssistantConversation> {
    for (;;) {
      const existing = primaryAssistantConversation(state.conversations, assistant.id);
      if (!existing) break;
      if (await this.host.getThreadInfo(existing.threadId)) {
        existing.source = 'shared';
        delete existing.peerOpenid;
        for (const task of state.tasks) if (task.assistantId === assistant.id) task.origin.threadId = existing.threadId;
        return existing;
      }
      state.conversations = state.conversations.filter((item) => item !== existing);
    }
    const threadId = await this.host.createConversation({ title: assistant.name, modelSelection: assistant.modelSelection });
    const conversation: AssistantConversation = { assistantId: assistant.id, threadId, source: 'shared', createdAt: this.host.now().toISOString() };
    state.conversations.push(conversation);
    for (const task of state.tasks) if (task.assistantId === assistant.id) task.origin.threadId = threadId;
    return conversation;
  }

  /** Runs after readiness. Never deletes historical transcripts or moves a running turn. */
  async reconcile(state: AssistantsState): Promise<void> {
    for (const assistant of state.assistants) {
      const primary = primaryAssistantConversation(state.conversations, assistant.id);
      if (!primary) continue;
      const originals = state.conversations.filter((item) => item.assistantId === assistant.id && item !== primary && !item.mergedInto);
      for (const original of originals) {
        if (!await this.host.getThreadInfo(original.threadId)) {
          state.conversations = state.conversations.filter((item) => item !== original);
          continue;
        }
        if (!await this.host.mergeConversationHistory(original.threadId, primary.threadId)) continue;
        original.mergedInto = primary.threadId;
      }
    }
  }
}
