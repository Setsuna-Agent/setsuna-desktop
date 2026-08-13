import type {
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeApprovalReviewAssessment,
} from '../approvals.js';
import { recordFromJson, stringField, sweNetworkApprovalContext, swePermissionProfile } from './mapper-utils.js';
import { FILE_MUTATION_TOOL_NAMES, SHELL_TOOL_NAMES } from './tool-names.js';
import { fileUpdateChangesFromPreview } from './turn-mapper.js';
import type { SweGuardianApprovalReview, SweGuardianApprovalReviewAction } from './types.js';

export function guardianApprovalReviewAction(
  approval: RuntimeApprovalRequest,
): SweGuardianApprovalReviewAction {
  if (approval.networkApprovalContext) {
    const network = sweNetworkApprovalContext(approval.networkApprovalContext);
    return {
      type: 'networkAccess',
      host: network?.host ?? approval.networkApprovalContext.host,
      port: approval.networkApprovalContext.port,
      protocol: network?.protocol ?? 'http',
      target: approval.networkApprovalContext.target,
    };
  }
  if (FILE_MUTATION_TOOL_NAMES.has(approval.toolName)) {
    const args = recordFromJson(approval.argumentsPreview);
    return {
      type: 'applyPatch',
      cwd: guardianActionCwd(approval, args),
      files: fileUpdateChangesFromPreview(approval.argumentsPreview).map((change) => change.path),
    };
  }
  if (approval.toolName === 'request_permissions') {
    return {
      type: 'requestPermissions',
      permissions: swePermissionProfile(
        approval.permissionApprovalContext?.requestedPermissions,
      ),
      reason: approval.permissionApprovalContext?.reason ?? approval.reason ?? null,
    };
  }
  if (SHELL_TOOL_NAMES.has(approval.toolName)) {
    const args = recordFromJson(approval.argumentsPreview);
    return {
      type: 'command',
      command: guardianCommand(args, approval.toolName),
      cwd: guardianActionCwd(approval, args),
      source: 'shell',
    };
  }
  const parsedMcpName = guardianMcpToolName(approval.toolName);
  return {
    type: 'mcpToolCall',
    server: parsedMcpName?.server ?? 'setsuna-runtime',
    toolName: parsedMcpName?.toolName ?? approval.toolName,
  };
}

export function guardianApprovalReview(
  assessment: RuntimeApprovalReviewAssessment | undefined,
  decision: RuntimeApprovalDecision,
): SweGuardianApprovalReview {
  const status = assessment?.status === 'allowed'
    ? 'approved'
    : assessment?.status === 'denied'
      ? 'denied'
      : assessment?.status === 'timed_out'
        ? 'timedOut'
        : assessment?.status === 'failed'
          ? 'aborted'
          : decision === 'approve'
            ? 'approved'
            : decision === 'reject'
              ? 'denied'
              : 'aborted';
  return {
    status,
    ...(assessment?.riskLevel ? { riskLevel: assessment.riskLevel } : {}),
    ...(assessment?.userAuthorization
      ? { userAuthorization: assessment.userAuthorization }
      : {}),
    ...(assessment?.rationale ? { rationale: assessment.rationale } : {}),
  };
}

function guardianActionCwd(
  approval: RuntimeApprovalRequest,
  args: Record<string, unknown>,
): string {
  return stringField(
    args.cwd
    ?? args.directory
    ?? args.workdir
    ?? approval.permissionApprovalContext?.cwd,
  ) || '.';
}

function guardianCommand(args: Record<string, unknown>, fallback: string): string {
  const value = args.command ?? args.cmd;
  if (Array.isArray(value)) {
    const command = value.filter((item): item is string => typeof item === 'string').join(' ');
    if (command) return command;
  }
  return stringField(value) || fallback;
}

function guardianMcpToolName(toolName: string): { server: string; toolName: string } | null {
  if (!toolName.startsWith('mcp__')) return null;
  const [server, ...toolParts] = toolName.slice('mcp__'.length).split('__');
  const parsedToolName = toolParts.join('__');
  return server && parsedToolName ? { server, toolName: parsedToolName } : null;
}
