import { parseDesignMentions, type DesignConversationOwner, type DesignTurnHost } from '@setsuna-desktop/feature-design/contracts';
import { parseDesignSelectionMentions } from '@setsuna-desktop/feature-design/contracts/design-selection-mention';
import path from 'node:path';
import { designStorageDirectories } from '../adapters/workspace/design-storage-directories.js';
import { createDesignResourceOwnership } from '../adapters/workspace/design-workspace-resource-root.js';
import { designConversationOwnerKey } from '../adapters/workspace/design-conversation-relocation.js';
import { withFileStateUpdate } from '../adapters/store/file-state-coordinator.js';
import type { CollaborationRuntimeHost } from '@setsuna-desktop/feature-collaboration/contracts';
import type { RuntimeContainer } from '../runtime/runtime-factory.js';

export function createDesignTurnHost(runtime: RuntimeContainer): DesignTurnHost {
  const storage = designStorageDirectories(runtime.dataDir, runtime.workspaceProjects);
  const ownership = createDesignResourceOwnership(runtime.dataDir);
  async function documentOwner({ ref, documentId }: DesignConversationOwner) {
    const root = await storage.resolve(ref);
    const key = designConversationOwnerKey(root, ref.path, documentId);
    const project = async () => {
      const linked = await ownership.project(path.join(root, ref.path), documentId);
      return linked === undefined ? ref.projectId : linked ?? undefined;
    };
    return { root, key, project };
  }
  return {
    async list(owner) {
      const { key, root, project } = await documentOwner(owner);
      // Read after a file transfer commits or rolls back, including a failed rename onto an identical copy.
      return withFileStateUpdate(root, async () => {
        const projectId = await project();
        const threads = await runtime.threadStore.listThreads({ projectId, featureId: 'design', includeFeatures: true });
        return threads.filter((thread) => !thread.parentThreadId && (thread.origin
          ? thread.origin.entityId === key && thread.projectId === projectId
          : Boolean(projectId) && thread.projectId === projectId))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(({ id, title, origin }) => ({ id, title, ...(!origin ? { legacy: true } : {}) }));
      });
    },
    async create(owner) {
      const { project, key } = await documentOwner(owner);
      const { id, title } = await runtime.threadStore.createThread({ projectId: await project(),
        featureId: 'design', origin: { featureId: 'design', entityId: key }, memoryMode: 'disabled' });
      return { id, title };
    },
    async resolveOwnedRoot(threadId, owner) {
      const { key, root, project } = await documentOwner(owner);
      return withFileStateUpdate(root, async () => {
        const thread = await runtime.threadStore.getThreadMetadata(threadId);
        if (thread && thread.projectId === await project() && thread.origin?.featureId === 'design' && thread.featureId === 'design' && thread.origin.entityId === key) return root;
        return undefined;
      });
    },
    async cancel(threadId, expectedTurnId) {
      const turnId = runtime.agentLoop.activeTurnId(threadId);
      if (turnId && (!expectedTurnId || turnId === expectedTurnId)) await runtime.agentLoop.cancelTurn(threadId, turnId);
    },
  };
}

/** Attach a dispatched child before its first sampling step, using the coordinator's trusted identity. */
export function designCollaborationHost(runtime: RuntimeContainer): CollaborationRuntimeHost {
  const host = runtime.agentLoop.collaborationRuntimeHost();
  function designDispatch(featureId: string | undefined, parentId: string, turnId: string | undefined, prompt: string) {
    if (featureId === 'design' || runtime.designToolHost.ownsChatCanvas(parentId, turnId)) return true;
    // A draft mention identifies the intended canvas, but an old tab is not a live turn binding.
    if (!featureId && (parseDesignMentions(prompt).length || parseDesignSelectionMentions(prompt).length)) {
      throw new Error('Open the referenced design with chat_design open in the parent turn, then retry dispatching the agent.');
    }
    return false;
  }
  return {
    ...host,
    createThread(input, dispatch) {
      return designDispatch(dispatch.parentFeatureId, input.parentThreadId, dispatch.parentTurnId, dispatch.prompt)
        ? runtime.threadStore.createThread({ ...input, featureId: 'design' }) : host.createThread(input, dispatch);
    },
    async startTurn(threadId, input, execution) {
      const owner = execution?.owner;
      if (!owner || !designDispatch(owner.featureId, owner.parentThreadId, owner.parentTurnId, input.prompt)) {
        return host.startTurn(threadId, input, execution);
      }
      if (!input.turnId || !input.name) throw new Error('Missing design agent identity.');
      const agent = { threadId, turnId: input.turnId, name: input.name, colorIndex: owner.participantIndex };
      runtime.designToolHost.join(owner.parentThreadId, agent, owner.parentTurnId);
      try { return await host.startTurn(threadId, input, execution); }
      catch (error) {
        await runtime.designToolHost.cleanupTurn(agent);
        throw error;
      }
    },
  };
}
