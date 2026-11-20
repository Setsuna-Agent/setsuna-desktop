import type { DesignConversationOwner, DesignTurnHost } from '@setsuna-desktop/feature-design/contracts';
import { workspaceTarget } from '@setsuna-desktop/contracts';
import { designConversationOwnerKey } from '../adapters/workspace/design-conversation-relocation.js';
import { withFileStateUpdate } from '../adapters/store/file-state-coordinator.js';
import type { CollaborationRuntimeHost } from '@setsuna-desktop/feature-collaboration/contracts';
import type { RuntimeContainer } from '../runtime/runtime-factory.js';

export function createDesignTurnHost(runtime: RuntimeContainer): DesignTurnHost {
  async function documentOwner({ ref, documentId }: DesignConversationOwner) {
    const root = await runtime.workspaceProjects.resolveWorkspaceRoot(workspaceTarget(ref.projectId, ref.rootId));
    return { root, key: designConversationOwnerKey(root, ref.path, documentId) };
  }
  return {
    async list(owner) {
      const { key, root } = await documentOwner(owner);
      // Read after a file transfer commits or rolls back, including a failed rename onto an identical copy.
      const threads = await withFileStateUpdate(root, () => runtime.threadStore.listThreads({ projectId: owner.ref.projectId, includeFeatures: true }));
      return threads.filter((thread) => thread.featureId === 'design' && !thread.parentThreadId && (!thread.origin || thread.origin.entityId === key && thread.origin.featureId === 'design'))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ id, title, origin }) => ({ id, title, ...(!origin ? { legacy: true } : {}) }));
    },
    async create(owner) {
      const { id, title } = await runtime.threadStore.createThread({ projectId: owner.ref.projectId,
        featureId: 'design', origin: { featureId: 'design', entityId: (await documentOwner(owner)).key }, memoryMode: 'disabled' });
      return { id, title };
    },
    async resolveOwnedRoot(threadId, owner) {
      const { key, root } = await documentOwner(owner);
      const thread = await withFileStateUpdate(root, () => runtime.threadStore.getThreadMetadata(threadId));
      if (thread?.projectId === owner.ref.projectId && thread.origin?.featureId === 'design' && thread.featureId === 'design' && thread.origin.entityId === key) return root;
      return undefined;
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
  return {
    ...host,
    createThread(input, parentFeatureId) {
      return parentFeatureId === 'design' ? runtime.threadStore.createThread({ ...input, featureId: 'design' }) : host.createThread(input);
    },
    async startTurn(threadId, input, execution) {
      const owner = execution?.owner;
      if (owner?.featureId !== 'design') return host.startTurn(threadId, input, execution);
      if (!input.turnId || !input.name) throw new Error('Missing design agent identity.');
      const agent = { threadId, turnId: input.turnId, name: input.name, colorIndex: owner.participantIndex };
      runtime.designToolHost.join(owner.parentThreadId, agent);
      try { return await host.startTurn(threadId, input, execution); }
      catch (error) {
        await runtime.designToolHost.cleanupTurn(agent);
        throw error;
      }
    },
  };
}
