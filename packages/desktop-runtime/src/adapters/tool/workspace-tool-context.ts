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
  const backingProjectId = context.environment?.workspaceProjectId?.trim();
  const logicalProjectId = context.projectId?.trim();
  if (typeof explicitProjectId === 'string' && explicitProjectId.trim()) {
    const projectId = explicitProjectId.trim();
    if (isTemporaryWorkspaceProjectId(projectId)) {
      const activeWorkspaceId = backingProjectId || context.environment?.id.trim() || logicalProjectId;
      if (projectId !== activeWorkspaceId) {
        throw new Error('A conversation temporary workspace can only be used by its active thread.');
      }
    }
    if (backingProjectId && projectId === logicalProjectId) return backingProjectId;
    return projectId;
  }
  if (backingProjectId) return backingProjectId;
  if (logicalProjectId) return logicalProjectId;
  return context.environment?.id.trim() || undefined;
}
