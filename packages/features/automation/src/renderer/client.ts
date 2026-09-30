import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  createAutomation, createAutomationConversation, deleteAutomation, listAutomations,
  runAutomation, setAutomationStatus, updateAutomation, type AutomationDraft,
} from '../contracts/index.js';

export function createAutomationClient(transport: FeatureOperationTransport) {
  return {
    snapshot: (signal?: AbortSignal) => transport.call(listAutomations, undefined, { signal }),
    createConversation: () => transport.call(createAutomationConversation, undefined),
    create: (threadId: string, draft: AutomationDraft) => transport.call(createAutomation, { threadId, draft }),
    update: (taskId: string, draft: AutomationDraft) => transport.call(updateAutomation, { taskId, draft }),
    setStatus: (taskId: string, status: 'active' | 'paused') => transport.call(setAutomationStatus, { taskId, status }),
    run: (taskId: string) => transport.call(runAutomation, { taskId }),
    delete: (taskId: string) => transport.call(deleteAutomation, { taskId }),
  };
}
export type AutomationClient = ReturnType<typeof createAutomationClient>;
export const automationClientCapability = defineCapability<AutomationClient | null>({ id: 'automation.renderer-client', description: 'Typed scheduled-task management client' });
