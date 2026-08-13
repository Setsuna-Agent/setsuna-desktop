import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ApprovalReviewInput } from '../../ports/approval-reviewer.js';

export function serializeApprovalReviewAction(input: ApprovalReviewInput): string | null {
  try {
    return JSON.stringify({
      tool: {
        id: input.request.toolCallId,
        name: input.request.toolName,
      },
      reason: input.request.reason,
      environmentId: input.request.environmentId,
      executionRoot: normalizedExecutionRoot(input.executionRoot),
      retryKind: input.request.retryKind,
      arguments: input.arguments,
      additionalPermissions: input.request.additionalPermissions,
      permissionApprovalContext: input.request.permissionApprovalContext,
      networkApprovalContext: input.request.networkApprovalContext,
      proposedNetworkPolicyAmendments: input.request.proposedNetworkPolicyAmendments,
      proposedExecPolicyAmendment: input.request.proposedExecPolicyAmendment,
    });
  } catch {
    return null;
  }
}

/** Hashes material action semantics without retaining exact arguments in reviewer state. */
export function approvalReviewActionIdentity(input: ApprovalReviewInput): string | null {
  const canonical = canonicalJson({
    toolName: input.request.toolName,
    environmentId: input.request.environmentId,
    executionRoot: normalizedExecutionRoot(input.executionRoot),
    retryKind: input.request.retryKind,
    arguments: input.arguments,
    additionalPermissions: input.request.additionalPermissions,
    permissionApprovalContext: materialPermissionApprovalContext(input),
    networkApprovalContext: input.request.networkApprovalContext,
    proposedNetworkPolicyAmendments: input.request.proposedNetworkPolicyAmendments,
    proposedExecPolicyAmendment: input.request.proposedExecPolicyAmendment,
  });
  return canonical
    ? `sha256:${createHash('sha256').update(canonical).digest('hex')}`
    : null;
}

function normalizedExecutionRoot(value: string | undefined): string | undefined {
  return value?.trim() ? path.resolve(value) : undefined;
}

function materialPermissionApprovalContext(input: ApprovalReviewInput): unknown {
  const context = input.request.permissionApprovalContext;
  if (!context) return undefined;
  return {
    environmentId: context.environmentId,
    cwd: context.cwd,
    requestedPermissions: context.requestedPermissions,
    grantedPermissions: context.grantedPermissions,
  };
}

function canonicalJson(value: unknown): string | null {
  try {
    const normalized = canonicalValue(value, new Set());
    const serialized = JSON.stringify(normalized);
    return typeof serialized === 'string' ? serialized : null;
  } catch {
    return null;
  }
}

function canonicalValue(value: unknown, ancestors: Set<object>): unknown {
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) throw new TypeError('Circular approval action payload.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalValue(item, ancestors));
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalValue((value as Record<string, unknown>)[key], ancestors),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}
