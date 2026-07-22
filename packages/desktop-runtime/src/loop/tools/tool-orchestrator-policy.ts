import type {
  AnswerRuntimeApprovalInput,
  RuntimeApprovalAvailableDecision,
  RuntimeApprovalDecision,
  RuntimeConfigState,
  RuntimeExecPolicyAmendment,
  RuntimeNetworkPolicyAmendment,
  RuntimePermissionGrantResponse,
  RuntimeSandboxWorkspaceWrite,
  RuntimeToolCall,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import {
  ToolExecutionError,
  type RuntimeToolExecutionContext,
  type ToolExecutionEnvironment,
} from '../../ports/tool-host.js';
import {
  assessFileMutationPolicy,
  protectedWorkspaceMetadataPathForPath
} from '../../security/file-system-policy.js';
import {
  networkApprovalContextFromTool,
  networkApprovalKeysForContext,
  type RuntimeNetworkApprovalContext,
} from '../../security/network-approval-policy.js';
import { reusableShellCommandWords } from '../../security/shell-command-analysis.js';
import { abortReason } from '../core/runtime-turn-errors.js';

export type ToolApprovalRequirement =
  | { action: 'skip' }
  | {
      action: 'ask';
      reason: string;
      argumentsPreview: string;
      approvalKeys?: string[];
      persistentApprovalKeys?: string[];
      proposedExecPolicyAmendment?: RuntimeExecPolicyAmendment;
      environmentId?: string;
      additionalPermissions?: RequestPermissionProfileOutput;
    }
  | { action: 'reject'; reason: string };

export type EffectiveToolCall = {
  toolCall: RuntimeToolCall;
  parsedArguments: unknown;
  rejectionReason?: string;
};

export type RequestPermissionGrantScope = 'turn' | 'session';

export type NetworkRetryApprovalAnswer = AnswerRuntimeApprovalInput;

export const REQUEST_PERMISSIONS_TOOL_NAME = 'request_permissions';

export class ToolPolicyRejectedError extends Error {}

export function toolApprovalAvailableDecisions(requirement: Extract<ToolApprovalRequirement, { action: 'ask' }>): RuntimeApprovalAvailableDecision[] {
  const decisions: RuntimeApprovalAvailableDecision[] = [{ type: 'approve' }];
  if (requirement.proposedExecPolicyAmendment?.length) {
    decisions.push({
      type: 'approve_exec_policy_amendment',
      proposedExecPolicyAmendment: requirement.proposedExecPolicyAmendment,
    });
  } else if (requirement.approvalKeys?.length) {
    decisions.push({ type: 'approve_for_session' });
    if (requirement.persistentApprovalKeys?.length) {
      decisions.push({ type: 'approve_persistently' });
    }
  }
  decisions.push({ type: 'reject' });
  return decisions;
}

export function networkApprovalAvailableDecisions(
  networkApprovalContext?: RuntimeNetworkApprovalContext | null,
  commandWideNetworkApproval = false,
): RuntimeApprovalAvailableDecision[] {
  const decisions: RuntimeApprovalAvailableDecision[] = [
    { type: 'approve' },
    { type: 'approve_for_session' },
  ];
  for (const amendment of proposedNetworkPolicyAmendments(networkApprovalContext, commandWideNetworkApproval) ?? []) {
    decisions.push({ type: 'approve_network_policy_amendment', networkPolicyAmendment: amendment });
  }
  decisions.push({ type: 'reject' });
  return decisions;
}

export function decisionGrantsSessionReuse(decision: RuntimeApprovalDecision): boolean {
  return decision === 'approve_for_session'
    || decision === 'approve_exec_policy_amendment'
    || decision === 'approve_network_policy_amendment';
}

export function effectiveToolCallFor(toolCall: RuntimeToolCall, parsedArguments: unknown): EffectiveToolCall {
  const shellApplyPatch = shellApplyPatchInterception(toolCall.name, parsedArguments);
  if (!shellApplyPatch) return { toolCall, parsedArguments };
  const patchArguments = shellApplyPatch.patch
    ? {
        patch: shellApplyPatch.patch,
        ...(shellApplyPatch.workdir ? { workdir: shellApplyPatch.workdir } : {}),
        intercepted_from_shell_command: true,
      }
    : {};
  return {
    toolCall: {
      ...toolCall,
      name: 'apply_patch',
      arguments: JSON.stringify(patchArguments),
    },
    parsedArguments: patchArguments,
    rejectionReason: shellApplyPatch.rejectionReason,
  };
}

export function applyHookUpdatedInput(toolName: string, currentArguments: unknown, updatedInput: unknown): unknown {
  const current = recordInput(currentArguments);
  const updated = recordInput(updatedInput);
  if (isShellCommandToolName(toolName)) {
    const command = stringArg(updated.command ?? updated.cmd);
    if (!command) return updatedInput;
    return {
      ...current,
      ...(toolName === 'exec_command' ? { cmd: command } : { command }),
      ...(current.command !== undefined && toolName === 'exec_command' ? { command } : {}),
      ...(current.cmd !== undefined && toolName !== 'exec_command' ? { cmd: command } : {}),
    };
  }
  if (toolName === 'apply_patch') {
    const patch = stringArg(updated.command ?? updated.patch);
    return patch ? { ...current, patch } : updatedInput;
  }
  return updatedInput;
}

export function shellApplyPatchInterception(toolName: string, parsedArguments: unknown): { patch?: string; workdir?: string; rejectionReason?: string } | null {
  if (!isShellCommandToolName(toolName)) return null;
  const record = recordInput(parsedArguments);
  const command = stringArg(record.command ?? record.cmd);
  if (!usesShellApplyPatch(command)) return null;
  const invocation = extractApplyPatchFromShellCommand(command);
  if (!invocation) {
    return {
      rejectionReason: 'Shell apply_patch command could not be parsed. Use apply_patch directly, or use exactly apply_patch <<EOF / cd <path> && apply_patch <<EOF.',
    };
  }
  const shellWorkdir = stringArg(record.directory ?? record.workdir ?? record.cwd);
  return {
    patch: invocation.patch,
    workdir: combineShellApplyPatchWorkdirs(shellWorkdir, invocation.workdir),
  };
}

export function isShellCommandToolName(toolName: string): boolean {
  return toolName === 'run_shell_command' || toolName === 'exec_command';
}

export function requestedSandboxBypass(toolName: string, parsedArguments: unknown): boolean {
  if (!isShellCommandToolName(toolName)) return false;
  const record = recordInput(parsedArguments);
  return stringArg(record.sandbox_permissions ?? record.sandboxPermissions) === 'require_escalated';
}

export function execApprovalApprovalKeys(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext): string[] | undefined {
  if (!requestedSandboxBypass(toolCall.name, parsedArguments)) return undefined;
  const environmentId = environmentIdForContext(context);
  const prefix = validRequestedExecPrefixRule(parsedArguments);
  if (prefix.length) return [execApprovalPrefixKey(environmentId, prefix)];
  const command = shellCommandForApprovalKey(parsedArguments);
  return command ? [execApprovalExactKey(environmentId, command)] : undefined;
}

export function execApprovalSessionLookupKeys(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext): string[] {
  if (!requestedSandboxBypass(toolCall.name, parsedArguments)) return [];
  const environmentId = environmentIdForContext(context);
  const command = shellCommandForApprovalKey(parsedArguments);
  const words = reusableShellCommandWords(command);
  const keys = command ? [execApprovalExactKey(environmentId, command)] : [];
  for (let length = 1; length <= words.length; length += 1) {
    keys.push(execApprovalPrefixKey(environmentId, words.slice(0, length)));
  }
  return [...new Set(keys)];
}

export function requestedExecPrefixRule(parsedArguments: unknown): string[] {
  const record = recordInput(parsedArguments);
  const raw = record.prefix_rule ?? record.prefixRule;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => stringArg(item)).filter(Boolean);
}

export function validRequestedExecPrefixRule(parsedArguments: unknown): string[] {
  const prefix = requestedExecPrefixRule(parsedArguments);
  if (!prefix.length || isBannedExecPrefixSuggestion(prefix)) return [];
  const words = reusableShellCommandWords(shellCommandForApprovalKey(parsedArguments));
  if (!wordsStartWith(words, prefix)) return [];
  return prefix;
}

export function proposedExecPolicyAmendment(toolCall: RuntimeToolCall, parsedArguments: unknown): RuntimeExecPolicyAmendment | undefined {
  if (!requestedSandboxBypass(toolCall.name, parsedArguments)) return undefined;
  const prefix = validRequestedExecPrefixRule(parsedArguments);
  return prefix.length ? prefix : undefined;
}

export const BANNED_EXEC_PREFIX_SUGGESTIONS = [
  ['python3'],
  ['python3', '-'],
  ['python3', '-c'],
  ['python'],
  ['python', '-'],
  ['python', '-c'],
  ['py'],
  ['py', '-3'],
  ['pythonw'],
  ['pyw'],
  ['pypy'],
  ['pypy3'],
  ['git'],
  ['bash'],
  ['bash', '-lc'],
  ['sh'],
  ['sh', '-c'],
  ['sh', '-lc'],
  ['zsh'],
  ['zsh', '-lc'],
  ['/bin/zsh'],
  ['/bin/zsh', '-lc'],
  ['/bin/bash'],
  ['/bin/bash', '-lc'],
  ['pwsh'],
  ['pwsh', '-Command'],
  ['pwsh', '-c'],
  ['powershell'],
  ['powershell', '-Command'],
  ['powershell', '-c'],
  ['powershell.exe'],
  ['powershell.exe', '-Command'],
  ['powershell.exe', '-c'],
  ['env'],
  ['sudo'],
  ['node'],
  ['node', '-e'],
  ['perl'],
  ['perl', '-e'],
  ['ruby'],
  ['ruby', '-e'],
  ['php'],
  ['php', '-r'],
  ['lua'],
  ['lua', '-e'],
  ['osascript'],
];

export function isBannedExecPrefixSuggestion(prefix: string[]): boolean {
  return BANNED_EXEC_PREFIX_SUGGESTIONS.some((banned) =>
    banned.length === prefix.length && banned.every((word, index) => word === prefix[index]),
  );
}

export function wordsStartWith(words: string[], prefix: string[]): boolean {
  return prefix.length <= words.length && prefix.every((word, index) => word === words[index]);
}

export function execApprovalExactKey(environmentId: string, command: string): string {
  return ['exec-approval', environmentId, 'exact', command].join(':');
}

export function execApprovalPrefixKey(environmentId: string, prefix: string[]): string {
  return ['exec-approval', environmentId, 'prefix', stableStringify(prefix)].join(':');
}

export function usesShellApplyPatch(command: string): boolean {
  return /(?:^|[;&|]\s*)(?:apply_patch|applypatch)\b/.test(command)
    || /\b(?:apply_patch|applypatch)\s*<</.test(command)
    || /<<[A-Z0-9_'-]*\s*\n?[^|&;]*(?:apply_patch|applypatch)\b/.test(command);
}

export function extractApplyPatchFromShellCommand(command: string): { patch: string; workdir?: string } | null {
  const text = command.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const beginIndex = text.indexOf('*** Begin Patch');
  if (beginIndex < 0) return null;
  const endMatch = /^(\*\*\* End Patch)$/m.exec(text.slice(beginIndex));
  if (!endMatch) return null;
  const prefix = text.slice(0, beginIndex);
  const prefixMatch = /^\s*(?:(?:cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*&&\s*)?(?:apply_patch|applypatch)\s*<<[^\n]*\n)\s*$/.exec(prefix);
  if (!prefixMatch) return null;
  const patchEndIndex = beginIndex + endMatch.index + endMatch[1].length;
  const suffix = text.slice(patchEndIndex).trim();
  const heredocEnd = /^([A-Za-z0-9_'-]+)$/.test(suffix) ? '' : suffix;
  if (heredocEnd) return null;
  return {
    patch: text.slice(beginIndex, patchEndIndex),
    workdir: prefixMatch[1] ?? prefixMatch[2] ?? prefixMatch[3],
  };
}

export function combineShellApplyPatchWorkdirs(shellWorkdir: string, commandWorkdir: string | undefined): string | undefined {
  const base = shellWorkdir && shellWorkdir !== '.' ? shellWorkdir : '';
  const child = commandWorkdir && commandWorkdir !== '.' ? commandWorkdir : '';
  if (!base) return child || undefined;
  if (!child) return base;
  return path.isAbsolute(child) ? child : path.join(base, child);
}

export function assessFileMutationApproval(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, approvalPolicy: RuntimeConfigState['approvalPolicy']): ToolApprovalRequirement | null {
  const assessment = assessFileMutationPolicy({
    args: parsedArguments,
    approvalPolicy,
    permissionProfile: context.permissionProfile,
    projectId: context.projectId ?? context.environment.id,
    toolName: toolCall.name,
  });
  if (!assessment) return null;
  if (assessment.action === 'allow') return { action: 'skip' };
  if (assessment.action === 'reject') return { action: 'reject', reason: assessment.reason };
  return {
    action: 'ask',
    approvalKeys: assessment.approvalKeys,
    argumentsPreview: previewArguments(parsedArguments),
    reason: assessment.reason,
  };
}

export type AdditionalSandboxPermissions = {
  approvalKeys: string[];
  reason: string;
  rejectionReason?: string;
  sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite;
};

export type RequestPermissionProfileOutput = {
  network?: { enabled?: boolean };
  file_system?: {
    write?: string[];
    read?: string[];
    glob_scan_max_depth?: number;
    entries?: Array<{
      path: { type: 'path'; path: string } | { type: 'glob_pattern'; pattern: string };
      access: 'write' | 'read' | 'deny';
    }>;
  };
};

export type RequestPermissionsGrant = {
  approvalKeys: string[];
  cwd: string;
  environmentId: string;
  grantedPermissions: RequestPermissionProfileOutput;
  reason: string;
  rejectionReason?: string;
  requestReason?: string;
  requestedPermissions: unknown;
  sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite;
};

export function requestPermissionsGrantForTool(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, environment: ToolExecutionEnvironment): RequestPermissionsGrant {
  const record = recordInput(parsedArguments);
  const requestedPermissions = recordInput(record.permissions);
  const requestReason = stringArg(record.reason);
  const environmentId = environment.id || environmentIdForContext(context);
  const requestedEnvironmentId = stringArg(record.environment_id ?? record.environmentId);
  if (requestedEnvironmentId && requestedEnvironmentId !== environmentId) {
    return {
      approvalKeys: [],
      cwd: environment.cwd,
      environmentId,
      grantedPermissions: emptyRequestPermissionProfile(),
      reason: requestReason || `Additional permissions requested for ${toolCall.name}.`,
      rejectionReason: `request_permissions supports only the active environment (${environmentId}); got ${requestedEnvironmentId}.`,
      requestReason,
      requestedPermissions,
      sandboxWorkspaceWrite: {},
    };
  }

  const network = recordInput(requestedPermissions.network);
  const fileSystem = recordInput(requestedPermissions.file_system ?? requestedPermissions.fileSystem);
  const entryPermissions = requestPermissionEntryPaths(fileSystem.entries, environment.cwd);
  const writableRoots = normalizeRequestPermissionPaths([...stringList(fileSystem.write ?? fileSystem.writable_roots ?? fileSystem.writableRoots), ...entryPermissions.write], environment.cwd);
  const readGrants = normalizeRequestPermissionPaths([...stringList(fileSystem.read ?? fileSystem.read_roots ?? fileSystem.readRoots), ...entryPermissions.read], environment.cwd);
  const denyGrants = normalizeRequestPermissionPaths(entryPermissions.deny, environment.cwd);
  const deniedGlobPatterns = normalizeRequestPermissionGlobPatterns(entryPermissions.denyGlobPatterns, environment.cwd);
  const globScanMaxDepth = positiveInteger(fileSystem.glob_scan_max_depth ?? fileSystem.globScanMaxDepth);
  const protectedWritableRoot = writableRoots.find((root) => protectedWorkspaceMetadataPathForPath(root, context.permissionProfile));
  const sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite = {};
  if (network.enabled === true) sandboxWorkspaceWrite.networkAccess = true;
  if (readGrants.length) sandboxWorkspaceWrite.readableRoots = [...new Set(readGrants)];
  if (writableRoots.length && !protectedWritableRoot) sandboxWorkspaceWrite.writableRoots = [...new Set(writableRoots)];
  if (denyGrants.length) sandboxWorkspaceWrite.deniedRoots = [...new Set(denyGrants)];
  if (deniedGlobPatterns.length) sandboxWorkspaceWrite.deniedGlobPatterns = [...new Set(deniedGlobPatterns)];
  if (globScanMaxDepth) sandboxWorkspaceWrite.globScanMaxDepth = globScanMaxDepth;
  const grantedPermissions = requestPermissionProfileFromSandbox(sandboxWorkspaceWrite);
  const reasonParts = [
    requestReason,
    sandboxWorkspaceWrite.networkAccess ? 'network access' : '',
    sandboxWorkspaceWrite.readableRoots?.length ? `readable roots: ${sandboxWorkspaceWrite.readableRoots.join(', ')}` : '',
    sandboxWorkspaceWrite.writableRoots?.length ? `writable roots: ${sandboxWorkspaceWrite.writableRoots.join(', ')}` : '',
    sandboxWorkspaceWrite.deniedRoots?.length ? `denied roots: ${sandboxWorkspaceWrite.deniedRoots.join(', ')}` : '',
    sandboxWorkspaceWrite.deniedGlobPatterns?.length ? `denied globs: ${sandboxWorkspaceWrite.deniedGlobPatterns.join(', ')}` : '',
    protectedWritableRoot ? `protected metadata write root rejected: ${protectedWritableRoot}` : '',
  ].filter(Boolean);
  return {
    approvalKeys: requestPermissionsApprovalKeys(environmentId, grantedPermissions),
    cwd: environment.cwd,
    environmentId,
    grantedPermissions,
    reason: `Additional permissions requested: ${reasonParts.join('; ') || 'none'}.`,
    rejectionReason: protectedWritableRoot
      ? `request_permissions cannot grant write access to protected workspace metadata: ${protectedWritableRoot}.`
      : undefined,
    requestReason,
    requestedPermissions,
    sandboxWorkspaceWrite,
  };
}

export function requestPermissionEntryPaths(value: unknown, cwd: string): { read: string[]; write: string[]; deny: string[]; denyGlobPatterns: string[] } {
  const read: string[] = [];
  const write: string[] = [];
  const deny: string[] = [];
  const denyGlobPatterns: string[] = [];
  if (!Array.isArray(value)) return { read, write, deny, denyGlobPatterns };
  for (const item of value) {
    const entry = recordInput(item);
    const access = stringArg(entry.access);
    const entryPath = requestPermissionPath(entry.path, cwd);
    if (!entryPath) continue;
    if (entryPath.type === 'glob_pattern') {
      if (access === 'deny' || access === 'none') denyGlobPatterns.push(entryPath.pattern);
      continue;
    }
    const filePath = entryPath.path;
    if (access === 'write') write.push(filePath);
    if (access === 'read') read.push(filePath);
    if (access === 'deny' || access === 'none') deny.push(filePath);
  }
  return { read, write, deny, denyGlobPatterns };
}

export function requestPermissionPath(value: unknown, cwd: string): { type: 'path'; path: string } | { type: 'glob_pattern'; pattern: string } | null {
  if (typeof value === 'string') return { type: 'path', path: normalizeRequestPermissionPath(value, cwd) };
  const record = recordInput(value);
  const type = stringArg(record.type);
  if (!type || type === 'path') {
    const pathValue = record.path;
    return typeof pathValue === 'string' ? { type: 'path', path: normalizeRequestPermissionPath(pathValue, cwd) } : null;
  }
  if (type === 'glob_pattern') {
    const pattern = stringArg(record.pattern);
    return pattern ? { type: 'glob_pattern', pattern: normalizeRequestPermissionGlobPattern(pattern, cwd) } : null;
  }
  if (type === 'special') {
    const specialPath = requestPermissionSpecialPath(record.value, cwd);
    return specialPath ? { type: 'path', path: specialPath } : null;
  }
  return null;
}

export function normalizeRequestPermissionPaths(paths: string[], cwd: string): string[] {
  return [...new Set(paths.map((item) => normalizeRequestPermissionPath(item, cwd)).filter(Boolean))];
}

export function normalizeRequestPermissionGlobPatterns(patterns: string[], cwd: string): string[] {
  return [...new Set(patterns.map((item) => normalizeRequestPermissionGlobPattern(item, cwd)).filter(Boolean))];
}

export function normalizeRequestPermissionPath(value: unknown, cwd: string): string {
  const text = stringArg(value).replace(/\\/g, path.sep);
  if (!text) return '';
  if (text.startsWith('~/')) return path.resolve(homedir(), text.slice(2));
  return path.resolve(path.isAbsolute(text) ? text : path.join(cwd || process.cwd(), text));
}

export const PROJECT_ROOTS_GLOB_PATTERN_PREFIX = 'codex-project-roots://';

export function normalizeRequestPermissionGlobPattern(value: unknown, cwd: string): string {
  const text = stringArg(value).replace(/\\/g, path.sep);
  if (!text) return '';
  if (text.startsWith(PROJECT_ROOTS_GLOB_PATTERN_PREFIX)) {
    return path.resolve(cwd || process.cwd(), text.slice(PROJECT_ROOTS_GLOB_PATTERN_PREFIX.length));
  }
  if (text.startsWith('~/')) return path.resolve(homedir(), text.slice(2));
  return path.resolve(path.isAbsolute(text) ? text : path.join(cwd || process.cwd(), text));
}

export function requestPermissionSpecialPath(value: unknown, cwd: string): string {
  const record = recordInput(value);
  const kind = stringArg(record.kind ?? value);
  if (kind === 'root') return path.parse(path.resolve(cwd || process.cwd())).root;
  if (kind === 'project_roots' || kind === 'current_working_directory') {
    const subpath = stringArg(record.subpath);
    return normalizeRequestPermissionPath(subpath || '.', cwd);
  }
  if (kind === 'tmpdir') return path.resolve(tmpdir());
  if (kind === 'slash_tmp' && process.platform !== 'win32') return '/tmp';
  return '';
}

export function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

export function requestPermissionProfileFromSandbox(sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite): RequestPermissionProfileOutput {
  const permissions: RequestPermissionProfileOutput = {};
  if (sandboxWorkspaceWrite.networkAccess === true) permissions.network = { enabled: true };
  if (sandboxWorkspaceWrite.readableRoots?.length || sandboxWorkspaceWrite.writableRoots?.length || sandboxWorkspaceWrite.deniedRoots?.length || sandboxWorkspaceWrite.deniedGlobPatterns?.length) {
    const read = [...new Set(sandboxWorkspaceWrite.readableRoots ?? [])];
    const write = [...new Set(sandboxWorkspaceWrite.writableRoots)];
    const deny = [...new Set(sandboxWorkspaceWrite.deniedRoots ?? [])];
    const denyGlobPatterns = [...new Set(sandboxWorkspaceWrite.deniedGlobPatterns ?? [])];
    permissions.file_system = {
      ...(read.length ? { read } : {}),
      ...(write.length ? { write } : {}),
      ...(sandboxWorkspaceWrite.globScanMaxDepth ? { glob_scan_max_depth: sandboxWorkspaceWrite.globScanMaxDepth } : {}),
      entries: [
        ...read.map((filePath) => ({
          path: { type: 'path' as const, path: filePath },
          access: 'read' as const,
        })),
        ...write.map((filePath) => ({
          path: { type: 'path' as const, path: filePath },
          access: 'write' as const,
        })),
        ...deny.map((filePath) => ({
          path: { type: 'path' as const, path: filePath },
          access: 'deny' as const,
        })),
        ...denyGlobPatterns.map((pattern) => ({
          path: { type: 'glob_pattern' as const, pattern },
          access: 'deny' as const,
        })),
      ],
    };
  }
  return permissions;
}

export function emptyRequestPermissionProfile(): RequestPermissionProfileOutput {
  return {};
}

export type RequestPermissionResponse = {
  permissions: RequestPermissionProfileOutput;
  sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite;
  scope: RequestPermissionGrantScope;
  strictAutoReview: boolean;
};

export function requestPermissionResponseForDecision(
  decision: RuntimeApprovalDecision,
  permissionGrant: RuntimePermissionGrantResponse | undefined,
  request: RequestPermissionsGrant,
  context: RuntimeToolExecutionContext,
  environment: ToolExecutionEnvironment,
): RequestPermissionResponse {
  if (decision === 'reject') return emptyRequestPermissionResponse();
  const requestedSandbox = request.sandboxWorkspaceWrite;
  const decisionStrictAutoReview = decision === 'approve_for_turn_with_strict_auto_review';
  const requestedScope: RequestPermissionGrantScope = decision === 'approve_for_session' ? 'session' : 'turn';
  const grantScope = permissionGrant?.scope === 'session' ? 'session' : permissionGrant?.scope === 'turn' ? 'turn' : requestedScope;
  const strictAutoReview = Boolean(permissionGrant?.strictAutoReview ?? permissionGrant?.strict_auto_review ?? decisionStrictAutoReview);
  if (strictAutoReview && grantScope === 'session') return emptyRequestPermissionResponse();

  const grantedSandbox = permissionGrant
    ? sandboxWorkspaceWriteFromPermissionProfile(permissionGrant.permissions, context, environment)
    : requestedSandbox;
  const sandboxWorkspaceWrite = intersectSandboxWorkspaceWrite(requestedSandbox, grantedSandbox);
  return {
    permissions: requestPermissionProfileFromSandbox(sandboxWorkspaceWrite),
    sandboxWorkspaceWrite,
    scope: grantScope,
    strictAutoReview,
  };
}

export function emptyRequestPermissionResponse(): RequestPermissionResponse {
  return {
    permissions: emptyRequestPermissionProfile(),
    sandboxWorkspaceWrite: {},
    scope: 'turn',
    strictAutoReview: false,
  };
}

export function sandboxWorkspaceWriteFromPermissionProfile(value: unknown, context: RuntimeToolExecutionContext, environment: ToolExecutionEnvironment): RuntimeSandboxWorkspaceWrite {
  const record = recordInput(value);
  const network = recordInput(record.network);
  const fileSystem = recordInput(record.file_system ?? record.fileSystem);
  const entryPermissions = requestPermissionEntryPaths(fileSystem.entries, environment.cwd);
  const writableRoots = normalizeRequestPermissionPaths([...stringList(fileSystem.write ?? fileSystem.writable_roots ?? fileSystem.writableRoots), ...entryPermissions.write], environment.cwd);
  const readGrants = normalizeRequestPermissionPaths([...stringList(fileSystem.read ?? fileSystem.read_roots ?? fileSystem.readRoots), ...entryPermissions.read], environment.cwd);
  const denyGrants = normalizeRequestPermissionPaths(entryPermissions.deny, environment.cwd);
  const deniedGlobPatterns = normalizeRequestPermissionGlobPatterns(entryPermissions.denyGlobPatterns, environment.cwd);
  const globScanMaxDepth = positiveInteger(fileSystem.glob_scan_max_depth ?? fileSystem.globScanMaxDepth);
  const protectedWritableRoot = writableRoots.find((root) => protectedWorkspaceMetadataPathForPath(root, context.permissionProfile));
  const sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite = {};
  if (network.enabled === true) sandboxWorkspaceWrite.networkAccess = true;
  if (readGrants.length) sandboxWorkspaceWrite.readableRoots = [...new Set(readGrants)];
  if (writableRoots.length && !protectedWritableRoot) sandboxWorkspaceWrite.writableRoots = [...new Set(writableRoots)];
  if (denyGrants.length) sandboxWorkspaceWrite.deniedRoots = [...new Set(denyGrants)];
  if (deniedGlobPatterns.length) sandboxWorkspaceWrite.deniedGlobPatterns = [...new Set(deniedGlobPatterns)];
  if (globScanMaxDepth) sandboxWorkspaceWrite.globScanMaxDepth = globScanMaxDepth;
  return sandboxWorkspaceWrite;
}

export function intersectSandboxWorkspaceWrite(requested: RuntimeSandboxWorkspaceWrite, granted: RuntimeSandboxWorkspaceWrite): RuntimeSandboxWorkspaceWrite {
  const sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite = {};
  if (requested.networkAccess === true && granted.networkAccess === true) sandboxWorkspaceWrite.networkAccess = true;
  const readableRoots = intersectRoots(requested.readableRoots, granted.readableRoots);
  const writableRoots = intersectRoots(requested.writableRoots, granted.writableRoots);
  if (readableRoots.length) sandboxWorkspaceWrite.readableRoots = readableRoots;
  if (writableRoots.length) sandboxWorkspaceWrite.writableRoots = writableRoots;
  if (requested.deniedRoots?.length) sandboxWorkspaceWrite.deniedRoots = [...new Set(requested.deniedRoots)];
  if (requested.deniedGlobPatterns?.length) sandboxWorkspaceWrite.deniedGlobPatterns = [...new Set(requested.deniedGlobPatterns)];
  const grantedDepth = granted.globScanMaxDepth;
  const requestedDepth = requested.globScanMaxDepth;
  if (requestedDepth && grantedDepth) sandboxWorkspaceWrite.globScanMaxDepth = Math.min(requestedDepth, grantedDepth);
  else if (requestedDepth) sandboxWorkspaceWrite.globScanMaxDepth = requestedDepth;
  return sandboxWorkspaceWrite;
}

export function intersectRoots(requestedRoots: string[] | undefined, grantedRoots: string[] | undefined): string[] {
  const roots = new Set<string>();
  for (const requestedRoot of requestedRoots ?? []) {
    for (const grantedRoot of grantedRoots ?? []) {
      if (pathWithinOrEqual(grantedRoot, requestedRoot)) roots.add(grantedRoot);
      else if (pathWithinOrEqual(requestedRoot, grantedRoot)) roots.add(requestedRoot);
    }
  }
  return [...roots];
}

export function pathWithinOrEqual(candidate: string, root: string): boolean {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function assessAdditionalSandboxPermissionsApproval(
  toolCall: RuntimeToolCall,
  parsedArguments: unknown,
  context: RuntimeToolExecutionContext,
  approvalPolicy: RuntimeConfigState['approvalPolicy'],
  hasApprovalGate: boolean,
  environment: ToolExecutionEnvironment,
): ToolApprovalRequirement | null {
  const permissions = additionalSandboxPermissionsForTool(toolCall, parsedArguments, context, environment);
  if (!permissions) return null;
  if (permissions.rejectionReason) {
    return {
      action: 'reject',
      reason: permissions.rejectionReason,
    };
  }
  const hasFileSystemRoots = Boolean(
    permissions.sandboxWorkspaceWrite.readableRoots?.length
      || permissions.sandboxWorkspaceWrite.writableRoots?.length
      || permissions.sandboxWorkspaceWrite.deniedRoots?.length
      || permissions.sandboxWorkspaceWrite.deniedGlobPatterns?.length,
  );
  if (!permissions.sandboxWorkspaceWrite.networkAccess && !hasFileSystemRoots) {
    return {
      action: 'reject',
      reason: 'with_additional_permissions requires additional_permissions.network.enabled or additional_permissions.file_system read/write roots.',
    };
  }
  if (approvalPolicy === 'full') return { action: 'skip' };
  if (!hasApprovalGate) {
    return {
      action: 'reject',
      reason: 'with_additional_permissions requires an approval gate before granting extra sandbox permissions.',
    };
  }
  return {
    action: 'ask',
    approvalKeys: permissions.approvalKeys,
    argumentsPreview: previewArguments(parsedArguments),
    additionalPermissions: requestPermissionProfileFromSandbox(permissions.sandboxWorkspaceWrite),
    environmentId: environment.id || environmentIdForContext(context),
    reason: permissions.reason,
  };
}

export function additionalSandboxPermissionsForTool(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, environment: ToolExecutionEnvironment): AdditionalSandboxPermissions | null {
  if (!isShellCommandToolName(toolCall.name)) return null;
  const record = recordInput(parsedArguments);
  if (stringArg(record.sandbox_permissions ?? record.sandboxPermissions) !== 'with_additional_permissions') return null;
  const additional = recordInput(record.additional_permissions ?? record.additionalPermissions);
  const network = recordInput(additional.network);
  const fileSystem = recordInput(additional.file_system ?? additional.fileSystem);
  const entryPermissions = requestPermissionEntryPaths(fileSystem.entries, environment.cwd);
  const writableRoots = normalizeRequestPermissionPaths([...stringList(fileSystem.write ?? fileSystem.writable_roots ?? fileSystem.writableRoots), ...entryPermissions.write], environment.cwd);
  const readGrants = normalizeRequestPermissionPaths([...stringList(fileSystem.read ?? fileSystem.read_roots ?? fileSystem.readRoots), ...entryPermissions.read], environment.cwd);
  const denyGrants = normalizeRequestPermissionPaths(entryPermissions.deny, environment.cwd);
  const deniedGlobPatterns = normalizeRequestPermissionGlobPatterns(entryPermissions.denyGlobPatterns, environment.cwd);
  const globScanMaxDepth = positiveInteger(fileSystem.glob_scan_max_depth ?? fileSystem.globScanMaxDepth);
  const protectedWritableRoot = writableRoots.find((root) => protectedWorkspaceMetadataPathForPath(root, context.permissionProfile));
  const sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite = {};
  if (network.enabled === true) sandboxWorkspaceWrite.networkAccess = true;
  if (readGrants.length) sandboxWorkspaceWrite.readableRoots = [...new Set(readGrants)];
  if (writableRoots.length && !protectedWritableRoot) sandboxWorkspaceWrite.writableRoots = writableRoots;
  if (denyGrants.length) sandboxWorkspaceWrite.deniedRoots = [...new Set(denyGrants)];
  if (deniedGlobPatterns.length) sandboxWorkspaceWrite.deniedGlobPatterns = [...new Set(deniedGlobPatterns)];
  if (globScanMaxDepth) sandboxWorkspaceWrite.globScanMaxDepth = globScanMaxDepth;
  const reasonParts = [
    sandboxWorkspaceWrite.networkAccess ? 'network access' : '',
    readGrants.length ? `readable roots: ${readGrants.join(', ')}` : '',
    writableRoots.length ? `writable roots: ${writableRoots.join(', ')}` : '',
    denyGrants.length ? `denied roots: ${denyGrants.join(', ')}` : '',
    deniedGlobPatterns.length ? `denied globs: ${deniedGlobPatterns.join(', ')}` : '',
    protectedWritableRoot ? `protected metadata write root rejected: ${protectedWritableRoot}` : '',
  ].filter(Boolean);
  if (protectedWritableRoot) {
    return {
      approvalKeys: additionalSandboxApprovalKeys(toolCall, parsedArguments, context, sandboxWorkspaceWrite),
      reason: `Additional sandbox permissions requested for ${toolCall.name}: protected metadata write root rejected: ${protectedWritableRoot}.`,
      rejectionReason: `with_additional_permissions cannot grant write access to protected workspace metadata: ${protectedWritableRoot}.`,
      sandboxWorkspaceWrite,
    };
  }
  // 模型偶尔会只发送 with_additional_permissions 而漏掉具体授权内容。
  // 空授权不扩大沙箱边界，按 use_default 的安全语义继续执行即可。
  if (isEmptySandboxWorkspaceWrite(sandboxWorkspaceWrite)) return null;
  return {
    approvalKeys: additionalSandboxApprovalKeys(toolCall, parsedArguments, context, sandboxWorkspaceWrite),
    reason: `Additional sandbox permissions requested for ${toolCall.name}: ${reasonParts.join('; ') || 'none'}.`,
    sandboxWorkspaceWrite,
  };
}

export function additionalSandboxApprovalKeys(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext, sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite): string[] {
  const environmentId = context.projectId ?? context.threadId;
  return [
    ['additional-permissions', environmentId, toolCall.name, shellCommandForApprovalKey(parsedArguments), stableStringify(sandboxWorkspaceWrite)].join(':'),
  ];
}

export function requestPermissionsApprovalKeys(environmentId: string, grantedPermissions: RequestPermissionProfileOutput): string[] {
  return [
    ['request-permissions', environmentId, stableStringify(grantedPermissions)].join(':'),
  ];
}

export function environmentIdForContext(context: RuntimeToolExecutionContext): string {
  return context.environment.id || context.projectId || context.threadId;
}

export function shellCommandForApprovalKey(parsedArguments: unknown): string {
  const record = recordInput(parsedArguments);
  return stringArg(record.command ?? record.cmd);
}

export function mergeSandboxWorkspaceWrite(base: RuntimeSandboxWorkspaceWrite | undefined, extra: RuntimeSandboxWorkspaceWrite | undefined): RuntimeSandboxWorkspaceWrite {
  const merged: RuntimeSandboxWorkspaceWrite = { ...(base ?? {}) };
  if (!extra) return merged;
  if (extra.networkAccess === true) merged.networkAccess = true;
  if (extra.excludeTmpdirEnvVar === true) merged.excludeTmpdirEnvVar = true;
  if (extra.excludeSlashTmp === true) merged.excludeSlashTmp = true;
  if (extra.globScanMaxDepth) merged.globScanMaxDepth = extra.globScanMaxDepth;
  const readableRoots = [...(merged.readableRoots ?? []), ...(extra.readableRoots ?? [])].filter(Boolean);
  if (readableRoots.length) merged.readableRoots = [...new Set(readableRoots)];
  const writableRoots = [...(merged.writableRoots ?? []), ...(extra.writableRoots ?? [])].filter(Boolean);
  if (writableRoots.length) merged.writableRoots = [...new Set(writableRoots)];
  const deniedRoots = [...(merged.deniedRoots ?? []), ...(extra.deniedRoots ?? [])].filter(Boolean);
  if (deniedRoots.length) merged.deniedRoots = [...new Set(deniedRoots)];
  const deniedGlobPatterns = [...(merged.deniedGlobPatterns ?? []), ...(extra.deniedGlobPatterns ?? [])].filter(Boolean);
  if (deniedGlobPatterns.length) merged.deniedGlobPatterns = [...new Set(deniedGlobPatterns)];
  return merged;
}

export function isEmptySandboxWorkspaceWrite(value: RuntimeSandboxWorkspaceWrite | undefined): boolean {
  return !value?.networkAccess
    && !value?.excludeSlashTmp
    && !value?.excludeTmpdirEnvVar
    && !value?.readableRoots?.length
    && !value?.writableRoots?.length
    && !value?.deniedRoots?.length
    && !value?.deniedGlobPatterns?.length;
}

export function networkRetryApprovalKeys(
  toolCall: RuntimeToolCall,
  parsedArguments: unknown,
  context: RuntimeToolExecutionContext,
  networkApprovalContext: RuntimeNetworkApprovalContext | null = networkApprovalContextFromTool(toolCall.name, parsedArguments),
): string[] {
  const environmentId = context.projectId ?? context.threadId;
  if (networkApprovalContext && !isShellCommandToolName(toolCall.name)) {
    return networkApprovalKeysForContext(networkApprovalContext, environmentId);
  }
  return [
    ['network', environmentId, toolCall.name, approvalIdentityDigest(parsedArguments)].join(':'),
  ];
}

export function proposedNetworkPolicyAmendments(
  networkApprovalContext?: RuntimeNetworkApprovalContext | null,
  denyOnly = false,
): RuntimeNetworkPolicyAmendment[] | undefined {
  if (!networkApprovalContext?.host) return undefined;
  const host = networkApprovalContext.host.toLowerCase();
  return denyOnly
    ? [{ host, action: 'deny' }]
    : [{ host, action: 'allow' }, { host, action: 'deny' }];
}

export function networkPolicyDeniedError(error: ToolExecutionError): boolean {
  const data = recordInput(error.data);
  return data.network_policy_decision === 'deny';
}

export function sandboxRetryApprovalKeys(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext): string[] {
  const environmentId = context.projectId ?? context.threadId;
  return [
    ['sandbox-bypass', environmentId, toolCall.name, approvalIdentityDigest(parsedArguments)].join(':'),
  ];
}

export function sandboxReadableRootsRetryApprovalKeys(
  toolCall: RuntimeToolCall,
  parsedArguments: unknown,
  context: RuntimeToolExecutionContext,
  readableRoots: string[],
): string[] {
  const environmentId = context.projectId ?? context.threadId;
  return [
    ['sandbox-read', environmentId, toolCall.name, approvalIdentityDigest(parsedArguments), stableStringify(readableRoots)].join(':'),
  ];
}

export function suggestedSandboxReadableRoots(error: ToolExecutionError, context: RuntimeToolExecutionContext): string[] {
  const data = recordInput(error.data);
  const currentReadableRoots = context.sandboxWorkspaceWrite?.readableRoots ?? [];
  const deniedRoots = context.sandboxWorkspaceWrite?.deniedRoots ?? [];
  const home = path.resolve(homedir());
  const roots = new Set<string>();
  for (const rawRoot of stringList(data.suggested_readable_roots ?? data.suggestedReadableRoots)) {
    if (!path.isAbsolute(rawRoot)) continue;
    const root = path.resolve(rawRoot);
    if (root === path.parse(root).root || root === home) continue;
    if (currentReadableRoots.some((current) => pathWithinOrEqual(root, current))) continue;
    if (deniedRoots.some((denied) => pathWithinOrEqual(root, denied))) continue;
    roots.add(root);
    if (roots.size >= 8) break;
  }
  return [...roots];
}

export function approvalIdentityDigest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function networkApprovalContextFromToolError(error: ToolExecutionError): RuntimeNetworkApprovalContext | null {
  const data = error.data && typeof error.data === 'object' && !Array.isArray(error.data)
    ? error.data as Record<string, unknown>
    : {};
  const context = data.network_approval_context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const record = context as Record<string, unknown>;
  const host = typeof record.host === 'string' ? record.host.trim() : '';
  const protocol = typeof record.protocol === 'string' ? record.protocol.trim() as RuntimeNetworkApprovalContext['protocol'] : 'unknown';
  const port = typeof record.port === 'number' ? record.port : Number(record.port);
  const target = typeof record.target === 'string' ? record.target.trim() : '';
  if (!host || !target || !Number.isFinite(port)) return null;
  return {
    host,
    protocol,
    port,
    target,
  };
}

export function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringArg(item)).filter(Boolean)
    : [];
}

export function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function previewArguments(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').slice(0, 1200);
}

export function appendHookAdditionalContexts(content: string, contexts: string[]): string {
  const visibleContexts = contexts.map((item) => item.trim()).filter(Boolean);
  if (!visibleContexts.length) return content;
  return [
    content,
    '',
    '<hook_additional_context>',
    ...visibleContexts,
    '</hook_additional_context>',
  ].join('\n');
}

export function toolRunWithCancellationProfile<T>(promise: Promise<T>, signal: AbortSignal, waitsForRuntimeCancellation: boolean): Promise<T> {
  if (waitsForRuntimeCancellation) return promise;
  // 某些 runtime 会自行管理后台进程生命周期。轮次取消后，不能让一直未完成的工具
  // Promise 继续维持代理轮次活动。
  void promise.catch(() => undefined);
  return abortable(promise, signal);
}

export function throwIfApprovalCancelled(decision: RuntimeApprovalDecision): void {
  if (decision !== 'cancel') return;
  const error = new Error('Turn cancelled by approval decision.');
  error.name = 'AbortError';
  throw error;
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
