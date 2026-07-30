import type { RuntimeContainer } from '../runtime-factory.js';

type RuntimeWorkspaceOperations = Pick<
  RuntimeContainer,
  'agentLoop' | 'threadStore' | 'workspaceProjects'
>;

/**
 * Archives a workspace only after every active project thread has committed
 * its own archived state. The REST adapter only parses the project identity.
 */
export async function archiveRuntimeWorkspaceProject(
  runtime: RuntimeWorkspaceOperations,
  projectId: string,
): Promise<void> {
  const projectThreads = await runtime.threadStore.listThreads({
    includeArchived: true,
    projectId,
  });

  // Keep thread mutations serialized by their existing owner. If one fails,
  // the project remains visible so the operation can be retried safely.
  for (const thread of projectThreads) {
    if (thread.archived) continue;
    await runtime.agentLoop.withThreadMutation(
      thread.id,
      () => runtime.threadStore.updateThread(thread.id, { archived: true }),
    );
  }

  await runtime.workspaceProjects.archiveProject(projectId);
}
