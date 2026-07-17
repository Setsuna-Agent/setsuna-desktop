import { isTemporaryWorkspaceProjectId } from '@setsuna-desktop/contracts';
import type { ToolExecutionContext } from '../../ports/tool-host.js';

/**
 * Resolve the workspace selected for a tool without turning a conversation workspace into
 * a persisted project scope. Global threads intentionally keep context.projectId undefined.
 */
export function workspaceProjectIdForToolContext(
  explicitProjectId: unknown,
  context: ToolExecutionContext,
): string | undefined {
  if (typeof explicitProjectId === 'string' && explicitProjectId.trim()) {
    const projectId = explicitProjectId.trim();
    if (isTemporaryWorkspaceProjectId(projectId)) {
      const activeWorkspaceId = context.environment?.id.trim() || context.projectId?.trim();
      if (projectId !== activeWorkspaceId) {
        throw new Error('A conversation temporary workspace can only be used by its active thread.');
      }
    }
    return projectId;
  }
  if (context.projectId?.trim()) return context.projectId.trim();
  return context.environment?.id.trim() || undefined;
}
