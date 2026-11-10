import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  createAssistant, deleteAssistant, deleteAssistantSidebarEntry, listAssistants, openAssistantConversation, revealAssistantQqSecret, setAssistantQqSecret,
  updateAssistant, updateAssistantPeer, updateAssistantSidebarEntry, type AssistantDraft, type AssistantPeerUpdate,
  type AssistantSidebarPatch, type AssistantSidebarTarget,
} from '../contracts/index.js';
import { createAssistantsStore, type AssistantsStore } from './store.js';

export function createAssistantsClient(transport: FeatureOperationTransport) {
  return {
    snapshot: (signal?: AbortSignal) => transport.call(listAssistants, undefined, { signal }),
    create: (draft: AssistantDraft) => transport.call(createAssistant, { draft }),
    update: (assistantId: string, draft: AssistantDraft) => transport.call(updateAssistant, { assistantId, draft }),
    delete: (assistantId: string) => transport.call(deleteAssistant, { assistantId }),
    openConversation: (assistantId: string) => transport.call(openAssistantConversation, { assistantId }),
    updateSidebarEntry: (target: AssistantSidebarTarget, patch: AssistantSidebarPatch) => transport.call(updateAssistantSidebarEntry, { ...target, ...patch }),
    deleteSidebarEntry: (target: AssistantSidebarTarget) => transport.call(deleteAssistantSidebarEntry, target),
    revealQqSecret: (assistantId: string, signal?: AbortSignal) => transport.call(revealAssistantQqSecret, { assistantId }, { signal }),
    setQqSecret: (assistantId: string, secret: string | null) => transport.call(setAssistantQqSecret, { assistantId, secret }),
    updatePeer: (assistantId: string, peer: AssistantPeerUpdate) => transport.call(updateAssistantPeer, { assistantId, peer }),
  };
}
export type AssistantsClient = ReturnType<typeof createAssistantsClient>;

export type AssistantsRendererService = Readonly<{ client: AssistantsClient; store: AssistantsStore }>;

export function createAssistantsRendererService(transport: FeatureOperationTransport): AssistantsRendererService {
  const client = createAssistantsClient(transport);
  return Object.freeze({ client, store: createAssistantsStore(client) });
}

export const assistantsRendererServiceCapability = defineCapability<AssistantsRendererService | null>({
  id: 'assistants.renderer-service',
  description: 'Typed assistant management client and its shared snapshot',
});
