import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import path from 'node:path';

export const FILE_MUTATION_TOOL_NAMES = new Set(['apply_patch', 'write_file', 'append_file', 'delete_file', 'edit', 'edit_file', 'workspace_write_file']);
const PROTECTED_WORKSPACE_METADATA_DIRS = new Set(['.git', '.agents', '.codex']);

export type FileMutationPolicyAssessment =
  | { action: 'allow'; paths: string[]; approvalKeys: string[] }
  | { action: 'ask'; reason: string; paths: string[]; approvalKeys: string[] }
  | { action: 'reject'; reason: string; paths: string[]; approvalKeys: string[] };

export type FileMutationPolicyInput = {
  toolName: string;
  args: unknown;
  approvalPolicy?: RuntimeConfigState['approvalPolicy'];
  permissionProfile?: RuntimeConfigState['permissionProfile'];
  projectId?: string;
};

export function isFileMutationToolName(name: string): boolean {
  return FILE_MUTATION_TOOL_NAMES.has(name);
}

export function assessFileMutationPolicy(input: FileMutationPolicyInput): FileMutationPolicyAssessment | null {
  if (!isFileMutationToolName(input.toolName)) return null;
  const permissionProfile = normalizePermissionProfile(input.permissionProfile);
  const paths = fileMutationPathsForPolicy(input.toolName, input.args);
  const approvalKeys = fileMutationApprovalKeys({
    paths,
    permissionProfile,
    projectId: input.projectId,
  });

  if (permissionProfile === 'read-only') {
    return {
      action: 'reject',
      approvalKeys,
      paths,
      reason: 'Writing is blocked by the read-only permission profile.',
    };
  }

  const protectedPath = firstProtectedWorkspaceMetadataPath(paths);
  if (protectedPath && permissionProfile !== 'danger-full-access') {
    return {
      action: 'reject',
      approvalKeys,
      paths,
      reason: `Writing protected workspace metadata is blocked: ${protectedPath}.`,
    };
  }

  if (input.approvalPolicy === 'strict') {
    return {
      action: 'ask',
      approvalKeys,
      paths,
      reason: `Strict approval policy requires confirmation before applying file change ${input.toolName}.`,
    };
  }

  return { action: 'allow', approvalKeys, paths };
}

export function protectedWorkspaceMetadataPathForTool(toolName: string, args: unknown, permissionProfile?: RuntimeConfigState['permissionProfile']): string {
  if (normalizePermissionProfile(permissionProfile) === 'danger-full-access') return '';
  return firstProtectedWorkspaceMetadataPath(fileMutationPathsForPolicy(toolName, args));
}

export function protectedWorkspaceMetadataPathForPath(filePath: unknown, permissionProfile?: RuntimeConfigState['permissionProfile']): string {
  if (normalizePermissionProfile(permissionProfile) === 'danger-full-access') return '';
  return firstProtectedWorkspaceMetadataPath([normalizeToolPathForPolicy(filePath)]);
}

export function fileMutationPathsForPolicy(toolName: string, args: unknown): string[] {
  const record = recordInput(args);
  if (toolName === 'apply_patch') return applyPatchPathsForPolicy(String(record.patch || ''), normalizeToolPathForPolicy(record.workdir));
  const paths = [
    record.file_path,
    record.path,
    record.target_path,
    record.file,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return [...new Set(paths.map(normalizeToolPathForPolicy))].filter(Boolean);
}

export function fileMutationApprovalKeys({ paths, permissionProfile, projectId }: { paths: string[]; permissionProfile?: RuntimeConfigState['permissionProfile']; projectId?: string }): string[] {
  const profile = normalizePermissionProfile(permissionProfile);
  return [...new Set(paths.map((filePath) => {
    const normalizedPath = normalizeToolPathForPolicy(filePath);
    return normalizedPath ? JSON.stringify({ type: 'file-write', projectId: projectId || 'default-project', profile, path: normalizedPath }) : '';
  }).filter(Boolean))];
}

export function normalizeToolPathForPolicy(value: unknown): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function applyPatchPathsForPolicy(patch: string, workdir = ''): string[] {
  const paths: string[] = [];
  const matcher = /^\*\*\* (?:Add|Delete|Update) File: (.+)$|^\*\*\* Move to: (.+)$/gm;
  for (const match of patch.matchAll(matcher)) {
    const value = match[1] ?? match[2] ?? '';
    const normalized = normalizeApplyPatchPathForPolicy(value, workdir);
    if (normalized) paths.push(normalized);
  }
  return [...new Set(paths)];
}

function normalizeApplyPatchPathForPolicy(value: unknown, workdir: string): string {
  const normalized = normalizeToolPathForPolicy(value);
  if (!normalized || !workdir || isAbsoluteLikeToolPath(normalized)) return normalized;
  return normalizeToolPathForPolicy(path.posix.normalize(`${workdir}/${normalized}`));
}

function isAbsoluteLikeToolPath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:\//.test(value) || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function firstProtectedWorkspaceMetadataPath(paths: string[]): string {
  for (const filePath of paths) {
    const segments = filePath.split('/').filter(Boolean);
    if (segments.some((segment) => PROTECTED_WORKSPACE_METADATA_DIRS.has(segment.toLowerCase()))) return filePath;
  }
  return '';
}

function normalizePermissionProfile(value: unknown): RuntimeConfigState['permissionProfile'] {
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') return value;
  return 'workspace-write';
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
