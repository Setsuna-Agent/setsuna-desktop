import type { RuntimeToolCall, RuntimeConfigState } from '@setsuna-desktop/contracts';
import type { RuntimeToolExecutionContext } from '../../ports/tool-host.js';
import { assessFileMutationPolicy } from '../../security/file-system-policy.js';
import { externalFileMutationPaths } from '../../security/file-mutation-access.js';
import { previewArguments, requestPermissionProfileFromSandbox, type ToolApprovalRequirement } from './tool-orchestrator-policy.js';

export function assessFileMutationApproval(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, approvalPolicy: RuntimeConfigState['approvalPolicy']): ToolApprovalRequirement | null {
  const assessment = assessFileMutationPolicy({
    args: parsedArguments,
    approvalPolicy,
    permissionProfile: context.permissionProfile,
    projectId: context.projectId ?? context.environment.id,
    toolName: toolCall.name,
  });
  if (!assessment) return null;
  if (assessment.action === 'reject') return { action: 'reject', reason: assessment.reason };
  const externalPaths = externalFileMutationPaths(toolCall.name, parsedArguments, context);
  if (externalPaths.length) {
    const grant = { readableRoots: externalPaths, writableRoots: externalPaths };
    return {
      action: 'ask',
      approvalKeys: externalPaths.map((filePath) => JSON.stringify(['file-access', context.environment.id, context.permissionProfile, filePath])),
      argumentsPreview: previewArguments(parsedArguments),
      reason: `Writing outside the project directories requires approval: ${externalPaths.join(', ')}`,
      environmentId: context.environment.id,
      additionalPermissions: requestPermissionProfileFromSandbox(grant),
      fileAccessGrant: grant,
    };
  }
  if (assessment.action === 'allow') return { action: 'skip' };
  return {
    action: 'ask',
    approvalKeys: assessment.approvalKeys,
    argumentsPreview: previewArguments(parsedArguments),
    reason: assessment.reason,
  };
}
