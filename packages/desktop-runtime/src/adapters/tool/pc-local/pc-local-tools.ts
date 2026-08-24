/** Public facade and dispatcher for the modular PC local-tool implementation. */

import type {
  RuntimeNetworkPolicyAmendment,
  RuntimePermissionProfile,
  RuntimeSandboxWorkspaceWrite,
} from '@setsuna-desktop/contracts';
import path from 'node:path';
import type { ShellToolchain } from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import type { WorkspaceSearchEngine } from '../../../ports/workspace-search-engine.js';
import { isFileMutationToolName, protectedWorkspaceMetadataPathForTool } from '../../../security/file-system-policy.js';
import { errorMessage } from '../../../shared/node-errors.js';
import {
  parsePartialAppendFileArguments,
  parsePartialApplyPatchArguments,
  parsePartialDeleteFileArguments,
  parsePartialEditFileArguments,
  parsePartialWriteFileArguments,
  parseToolArguments,
} from './pc-local-tool-arguments.js';
import { MCP_CONFIG_PATH, SHELL_GRACEFUL_KILL_MS } from './pc-local-tool-constants.js';
import {
  LOCAL_TOOL_DEFINITIONS,
} from './pc-local-tool-definitions.js';
import {
  buildFileDiff,
  previewComparablePreviousContent,
} from './pc-local-tool-diff.js';
import { createFileMutationCoordinator } from './pc-local-tool-file-transaction.js';
import {
  appendLocalFile,
  applyLocalPatch,
  calculateAppendFile,
  calculateApplyPatch,
  calculateDeleteFile,
  calculateEditFile,
  calculateWriteFile,
  deleteLocalFile,
  editLocalFile,
  findFiles,
  integrityTokenForCalculatedMutation,
  isEditToolName,
  listDirectory,
  normalizeEditArgs,
  readLocalFile,
  searchText,
  type PcLocalFileState,
  writeLocalFile,
} from './pc-local-tool-files.js';
import {
  configureMcpServer,
  isLocalMcpConfigPath,
} from './pc-local-tool-mcp.js';
import {
  gitLog,
  gitShow,
  gitStatus,
  readDiff,
} from './pc-local-tool-git.js';
import { updatePlan } from './pc-local-tool-plan.js';
import {
  deniedRootPathForFileMutationTool,
  protectedPathForFileMutationTool,
} from './pc-local-tool-paths.js';
import {
  listAllBackgroundShellProcesses,
  listBackgroundShellProcesses,
} from './pc-local-tool-background-shell-processes.js';
import {
  approvalDisabledDestructiveCommandReason,
  createShellSandboxExecutionPlan,
  loadShellPolicyRules,
  normalizeShellCommandForRisk,
  obviousHighRiskShellReason,
  shellPolicyDecision,
  shellSandboxCapability,
  shellSandboxProfile,
  shellSandboxUnavailableReason,
} from './pc-local-tool-shell-policy.js';
import {
  closeShellProcessStore,
  createShellProcessStore,
  isShellSessionVisibleToState,
  listShellProcesses,
  pruneShellProcessStore,
  readShellProcess,
  removeShellSession,
  runShellCommand,
  shellStdinApprovalReason,
  shellSessionsForStateClose,
  shellSessionsMap,
  terminateBackgroundShellProcess,
  terminateShellProcess,
  terminateShellSession,
  writeShellProcess,
} from './pc-local-tool-shell-process.js';
import {
  errorResult,
  sleep,
} from './pc-local-tool-utils.js';

export {
  parsePartialAppendFileArguments,
  parsePartialApplyPatchArguments,
  parsePartialDeleteFileArguments,
  parsePartialEditFileArguments,
  parsePartialWriteFileArguments,
  parseToolArguments,
};

export {
  isLocalMcpConfigPath,
};

export {
  createShellSandboxExecutionPlan,
  shellSandboxCapability,
  shellSandboxProfile,
  shellSandboxUnavailableReason,
};

export {
  closeShellProcessStore,
  createShellProcessStore,
  listAllBackgroundShellProcesses,
  listBackgroundShellProcesses,
  shellStdinApprovalReason,
  terminateBackgroundShellProcess,
};

export {
  LOCAL_TOOL_DEFINITIONS,
};

type ToolArguments = Record<string, unknown>;

export type LocalToolExecutionOptions = {
  signal?: AbortSignal;
  threadId?: string;
  turnId?: string;
  toolCallId?: string;
  onProgress?: (progress: Record<string, unknown>) => void;
};

export type CreateLocalToolStateOptions = {
  shellProcessStore?: ReturnType<typeof createShellProcessStore>;
  environmentId?: string;
  mcpConfigPath?: string;
  userPolicyConfigPaths?: readonly string[];
  workspaceSearchEngine?: WorkspaceSearchEngine;
};

export type PcLocalToolState = PcLocalFileState & {
  root: string;
  environmentId: string;
  mcpConfigPath: string;
  permissionProfile: RuntimePermissionProfile;
  sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite;
  osSandbox: boolean;
  shellPolicyRules: ReturnType<typeof loadShellPolicyRules>;
  networkPolicyAmendments: RuntimeNetworkPolicyAmendment[];
  shellProcessStore: ReturnType<typeof createShellProcessStore>;
  shellProcesses: ReturnType<typeof createShellProcessStore>['sessions'];
  ownedShellProcessIds: Set<string>;
  ownsShellProcessStore: boolean;
  workspaceSearchEngine?: WorkspaceSearchEngine;
  shellEnvironment?: Record<string, string>;
  shellToolchain?: ShellToolchain;
};

export type LocalToolTurnContext = {
  turnId?: string;
  threadId?: string;
  toolCallId?: string;
};

export function createLocalToolState(
  root = process.cwd(),
  options: CreateLocalToolStateOptions = {},
): PcLocalToolState {
  const workspaceRoot = path.resolve(String(root || process.cwd()));
  const shellProcessStore = options.shellProcessStore || createShellProcessStore();
  return {
    root: workspaceRoot,
    environmentId: options.environmentId || '',
    mcpConfigPath: options.mcpConfigPath || MCP_CONFIG_PATH,
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: {},
    // 主机没有受支持的沙箱提供方时，受限 Shell 配置必须以拒绝方式失败。
    // 只有显式获批的绕过操作才能暂时禁用此限制。
    osSandbox: true,
    shellPolicyRules: loadShellPolicyRules(
      workspaceRoot,
      options.userPolicyConfigPaths ?? [],
    ),
    networkPolicyAmendments: [],
    reads: new Map(),
    fileMutationCoordinator: createFileMutationCoordinator(),
    shellProcessStore,
    shellProcesses: shellProcessStore.sessions,
    ownedShellProcessIds: new Set(),
    ownsShellProcessStore: !options.shellProcessStore,
    workspaceSearchEngine: options.workspaceSearchEngine,
  };
}

export function toolNeedsConfirmation(name: string) {
  return name === 'configure_mcp_server';
}

export function shellCommandRisk(
  command: unknown,
  riskLevel: unknown = '',
  riskReason: unknown = '',
  state: PcLocalToolState | null = null,
) {
  const normalized = normalizeShellCommandForRisk(command);
  if (!normalized) return { needsConfirmation: false, reason: '', rejectWhenApprovalDisabled: false };
  const policy = shellPolicyDecision(command, state);
  if (policy.action === 'allow') {
    return { needsConfirmation: false, reason: policy.reason, rejectWhenApprovalDisabled: false };
  }
  const rejectWhenApprovalDisabled = Boolean(approvalDisabledDestructiveCommandReason(command));
  if (policy.action === 'ask') {
    return { needsConfirmation: true, reason: policy.reason, rejectWhenApprovalDisabled };
  }
  if (policy.action === 'deny') {
    return { needsConfirmation: true, reason: policy.reason, rejectWhenApprovalDisabled };
  }
  const declaredRisk = String(riskLevel || '').trim().toLowerCase();
  const declaredReason = String(riskReason || '').trim();
  const fallbackReason = obviousHighRiskShellReason(normalized);

  if (fallbackReason) return { needsConfirmation: true, reason: fallbackReason, rejectWhenApprovalDisabled };
  if (declaredRisk === 'high') {
    return {
      needsConfirmation: true,
      reason: declaredReason || '模型将该命令标记为高风险。',
      rejectWhenApprovalDisabled,
    };
  }
  if (declaredRisk === 'low') return { needsConfirmation: false, reason: '', rejectWhenApprovalDisabled };
  return { needsConfirmation: true, reason: '命令未声明风险等级。', rejectWhenApprovalDisabled };
}

export async function previewWriteFileDiff(
  args: ToolArguments,
  state: PcLocalToolState = createLocalToolState(),
) {
  const result = await calculateWriteFile(args, state);
  if (!result.ok) return null;
  const isPartial = args?.complete === false;
  const diff = buildFileDiff({
    filePath: result.filePath,
    root: state.root,
    existed: result.existed,
    previousContent: isPartial && result.existed
      ? previewComparablePreviousContent(result.previousContent, result.nextContent)
      : result.previousContent,
    nextContent: result.nextContent,
  });
  const integrityToken = await integrityTokenForCalculatedMutation(result, state);

  return {
    path: diff.path,
    action: diff.action,
    additions: diff.additions,
    deletions: diff.deletions,
    partial: isPartial,
    diff,
    integrityToken,
  };
}

export async function previewEditFileDiff(
  args: ToolArguments,
  state: PcLocalToolState = createLocalToolState(),
) {
  const result = await calculateEditFile(normalizeEditArgs(args), state, { enforcePriorRead: false });
  if (!result.ok) return null;
  return {
    path: result.diff.path,
    action: result.diff.action,
    additions: result.diff.additions,
    deletions: result.diff.deletions,
    partial: false,
    diff: result.diff,
    integrityToken: await integrityTokenForCalculatedMutation(result, state),
  };
}

export async function previewAppendFileDiff(
  args: ToolArguments,
  state: PcLocalToolState = createLocalToolState(),
) {
  const result = await calculateAppendFile(args, state, { enforcePriorRead: false });
  if (!result.ok) return null;
  return {
    path: result.diff.path,
    action: result.diff.action,
    additions: result.diff.additions,
    deletions: result.diff.deletions,
    partial: args?.complete === false,
    diff: result.diff,
    integrityToken: await integrityTokenForCalculatedMutation(result, state),
  };
}

export async function previewDeleteFileDiff(
  args: ToolArguments,
  state: PcLocalToolState = createLocalToolState(),
) {
  const result = await calculateDeleteFile(args, state, { enforcePriorRead: false });
  if (!result.ok) return null;
  return {
    path: result.diff.path,
    action: result.diff.action,
    additions: result.diff.additions,
    deletions: result.diff.deletions,
    partial: false,
    diff: result.diff,
    integrityToken: await integrityTokenForCalculatedMutation(result, state),
  };
}

export async function previewApplyPatchDiff(
  args: ToolArguments,
  state: PcLocalToolState = createLocalToolState(),
) {
  const result = await calculateApplyPatch(args, state);
  if (!result.ok) return null;
  const diff = result.diff;
  return diff
    ? {
        path: diff.path,
        action: diff.action,
        additions: diff.additions,
        deletions: diff.deletions,
        partial: false,
        diff,
        integrityToken: await integrityTokenForCalculatedMutation(result, state),
      }
    : null;
}

export async function executeLocalTool(
  name: string,
  args: ToolArguments,
  state: PcLocalToolState = createLocalToolState(),
  options: LocalToolExecutionOptions = {},
) {
  try {
    const mutationPolicyError = localFileMutationPolicyError(name, args, state);
    if (mutationPolicyError) return mutationPolicyError;
    if (name === 'list_directory') return await listDirectory(args, state);
    if (name === 'find_files') return await findFiles(args, state);
    if (name === 'search_text') return await searchText(args, state, options.signal);
    if (name === 'read_file') return await readLocalFile(args, state);
    if (name === 'git_status') return await gitStatus(state, options.signal);
    if (name === 'git_log') return await gitLog(args, state, options.signal);
    if (name === 'git_show') return await gitShow(args, state, options.signal);
    if (name === 'read_diff') return await readDiff(args, state, options.signal);
    if (name === 'update_plan') return updatePlan(args);
    if (name === 'configure_mcp_server') return await configureMcpServer(args, state);
    if (name === 'apply_patch') return await applyLocalPatch(args, state);
    if (name === 'write_file') return await writeLocalFile(args, state);
    if (name === 'append_file') return await appendLocalFile(args, state);
    if (name === 'delete_file') return await deleteLocalFile(args, state);
    if (isEditToolName(name)) return await editLocalFile(args, state);
    if (name === 'run_shell_command') return await runShellCommand(args, state, options);
    if (name === 'read_shell_process') return await readShellProcess(args, state);
    if (name === 'list_shell_processes') return listShellProcesses(args, state);
    if (name === 'write_shell_process') return await writeShellProcess(args, state);
    if (name === 'terminate_shell_process') return await terminateShellProcess(args, state);
    return errorResult('未知的本地操作。', {
      failure_kind: 'unknown_tool',
      failure_stage: 'validation',
    });
  } catch (error) {
    return errorResult(errorMessage(error));
  }
}

/** Run before previews as well as execution so a denied target is never read to build a diff. */
export function localFileMutationPolicyError(
  name: string,
  args: ToolArguments,
  state: PcLocalToolState = createLocalToolState(),
) {
  if (!isFileMutationToolName(name)) return null;
  if (state.permissionProfile === 'read-only') {
    return errorResult('当前权限配置为 read-only，不能修改工作区文件。', {
      failure_kind: 'permission_denied',
      failure_stage: 'preflight',
    });
  }
  const protectedPath = protectedWorkspaceMetadataPathForTool(name, args, state.permissionProfile);
  if (protectedPath) {
    return errorResult(`不能修改受保护的工作区元数据：${protectedPath}`, {
      failure_kind: 'permission_denied',
      failure_stage: 'preflight',
    });
  }
  const canonicalProtectedPath = protectedPathForFileMutationTool(name, args, state);
  if (canonicalProtectedPath) {
    return errorResult(`不能修改受保护的工作区元数据：${canonicalProtectedPath}`, {
      failure_kind: 'permission_denied',
      failure_stage: 'preflight',
    });
  }
  const deniedPath = deniedRootPathForFileMutationTool(name, args, state);
  if (deniedPath) {
    return errorResult(`不能修改 sandbox filesystem deny 规则覆盖的路径：${deniedPath}`, {
      failure_kind: 'permission_denied',
      failure_stage: 'preflight',
    });
  }
  return null;
}

export async function closeLocalToolState(state: PcLocalToolState = createLocalToolState()) {
  const sessions = shellSessionsForStateClose(state);
  sessions.forEach((session) => terminateShellSession(session, 'SIGTERM'));
  await Promise.allSettled(sessions.map((session) =>
    Promise.race([session.done, sleep(SHELL_GRACEFUL_KILL_MS + 1000)])
  ));
  for (const session of sessions) {
    state.shellProcesses?.delete?.(session.id);
  }
  state.ownedShellProcessIds?.clear?.();
  pruneShellProcessStore(state.shellProcessStore);
}

export async function cleanupLocalToolTurn(
  state: PcLocalToolState = createLocalToolState(),
  context: LocalToolTurnContext = {},
) {
  const turnId = String(context?.turnId || '');
  if (!turnId) return { terminated: 0 };
  const threadId = String(context?.threadId || '');
  const toolCallId = String(context?.toolCallId || '');
  const sessions = [...(shellSessionsMap(state).values?.() || [])]
    .filter((session) => !session.persist)
    .filter((session) => session.turnId === turnId)
    .filter((session) => !threadId || !session.threadId || session.threadId === threadId)
    .filter((session) => !toolCallId || session.toolCallId === toolCallId)
    .filter((session) => isShellSessionVisibleToState(state, session));

  sessions.forEach((session) => terminateShellSession(session, 'SIGTERM'));
  await Promise.allSettled(sessions.map((session) =>
    Promise.race([session.done, sleep(SHELL_GRACEFUL_KILL_MS + 1000)])
  ));
  for (const session of sessions) {
    removeShellSession(state, session.id);
  }
  return { terminated: sessions.length };
}
