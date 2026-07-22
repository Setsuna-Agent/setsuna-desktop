// @ts-nocheck

/** Public facade and dispatcher for the modular PC local-tool implementation. */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { isFileMutationToolName, protectedWorkspaceMetadataPathForTool } from '../../security/file-system-policy.js';
import {
  SHELL_GRACEFUL_KILL_MS,
  MCP_CONFIG_PATH,
  DEFAULT_MEMORY_STORE_DIR,
} from './pc-local-tool-constants.js';
import {
  sleep,
  shortSingleLine,
  relativeLabel,
  okResult,
  errorResult,
} from './pc-local-tool-utils.js';
import {
  resolveWorkspacePath,
  deniedRootPathForFileMutationTool,
  protectedPathForFileMutationTool,
  resolvePathForDisplay,
  formatPath,
} from './pc-local-tool-paths.js';
import {
  buildFileDiff,
  previewComparablePreviousContent,
} from './pc-local-tool-diff.js';
import {
  parseToolArguments,
  parsePartialWriteFileArguments,
  parsePartialApplyPatchArguments,
  parsePartialAppendFileArguments,
  parsePartialDeleteFileArguments,
  parsePartialEditFileArguments,
} from './pc-local-tool-arguments.js';
import {
  updatePlan,
  rememberMemory,
  normalizeRememberMemoryArgs,
  memoryStorePath,
  normalizePlanItems,
} from './pc-local-tool-memory.js';
import {
  isLocalMcpConfigPath,
  configureMcpServer,
  calculateMcpServerConfig,
} from './pc-local-tool-mcp.js';
import {
  listDirectory,
  findFiles,
  searchText,
  readLocalFile,
  applyLocalPatch,
  writeLocalFile,
  calculateWriteFile,
  calculateApplyPatch,
  appendLocalFile,
  deleteLocalFile,
  editLocalFile,
  calculateEditFile,
  calculateAppendFile,
  calculateDeleteFile,
  normalizeEditArgs,
  normalizeReadRange,
  rememberRead,
  rememberReadFileResult,
  rememberedReadFileResult,
  isEditToolName,
  integrityTokenForCalculatedMutation,
} from './pc-local-tool-files.js';
import { openValidatedReadableFile } from './pc-local-tool-secure-read.js';
import {
  createShellSandboxExecutionPlan,
  shellSandboxCapability,
  normalizeShellCommandForRisk,
  obviousHighRiskShellReason,
  shellPolicyDecision,
  loadShellPolicyRules,
  shellSandboxUnavailableReason,
  shellSandboxProfile,
} from './pc-local-tool-shell-policy.js';
import {
  createShellProcessStore,
  closeShellProcessStore,
  listBackgroundShellProcesses,
  terminateBackgroundShellProcess,
  shellSessionsForStateClose,
  removeShellSession,
  pruneShellProcessStore,
  shellSessionsMap,
  runShellCommand,
  readShellProcess,
  listShellProcesses,
  writeShellProcess,
  terminateShellProcess,
  gitStatus,
  gitLog,
  gitShow,
  readDiff,
  isShellSessionVisibleToState,
  terminateShellSession,
} from './pc-local-tool-shell-process.js';
import {
  LOCAL_TOOL_DEFINITIONS,
} from './pc-local-tool-definitions.js';
import { createFileMutationCoordinator } from './pc-local-tool-file-transaction.js';

export {
  parseToolArguments,
  parsePartialWriteFileArguments,
  parsePartialApplyPatchArguments,
  parsePartialAppendFileArguments,
  parsePartialDeleteFileArguments,
  parsePartialEditFileArguments,
};

export {
  isLocalMcpConfigPath,
};

export {
  createShellSandboxExecutionPlan,
  shellSandboxCapability,
  shellSandboxUnavailableReason,
  shellSandboxProfile,
};

export {
  createShellProcessStore,
  closeShellProcessStore,
  listBackgroundShellProcesses,
  terminateBackgroundShellProcess,
};

export {
  LOCAL_TOOL_DEFINITIONS,
};

export function createLocalToolState(root = process.cwd(), options = {}) {
  const workspaceRoot = path.resolve(String(root || process.cwd()));
  const shellProcessStore = options?.shellProcessStore || createShellProcessStore();
  return {
    root: workspaceRoot,
    environmentId: options?.environmentId || '',
    mcpConfigPath: MCP_CONFIG_PATH,
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: {},
    // 主机没有受支持的沙箱提供方时，受限 Shell 配置必须以拒绝方式失败。
    // 只有显式获批的绕过操作才能暂时禁用此限制。
    osSandbox: true,
    shellPolicyRules: loadShellPolicyRules(workspaceRoot),
    networkPolicyAmendments: [],
    reads: new Map(),
    readFileResults: new Map(),
    fileMutationCoordinator: createFileMutationCoordinator(),
    shellProcessStore,
    shellProcesses: shellProcessStore.sessions,
    ownedShellProcessIds: new Set(),
    ownsShellProcessStore: !options?.shellProcessStore,
    allowPassiveMemory: options?.allowPassiveMemory === true,
    memoryEnabled: options?.memoryEnabled !== false,
    memoryStorageRoot: options?.memoryStorageRoot || DEFAULT_MEMORY_STORE_DIR,
    workspaceSearchEngine: options?.workspaceSearchEngine,
  };
}

export async function rememberContextFileRead(args, state = createLocalToolState()) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  const expectedContent = String(args?.content ?? '');
  const opened = await openValidatedReadableFile(filePath, state);
  try {
    if (!opened.info.isFile()) return false;
    const currentContent = await opened.handle.readFile({ encoding: 'utf8' });
    if (currentContent !== expectedContent) return false;
    rememberRead(state, filePath, opened.info);
    rememberReadFileResult(state, filePath, opened.info, null, 'context');
    return true;
  } finally {
    await opened.handle.close().catch(() => undefined);
  }
}

export async function duplicateReadFileResult(args, state = createLocalToolState()) {
  const filePath = resolveWorkspacePath(args?.file_path ?? args?.path, state.root);
  const info = await stat(filePath);
  if (!info.isFile()) return null;

  const range = normalizeReadRange(args);
  const entry = rememberedReadFileResult(state, filePath, info, range);
  if (!entry) return null;

  const source = entry.source === 'context'
    ? 'desktop tool context'
    : 'earlier in this user request';
  const label = formatPath(filePath, state.root);
  return okResult(
    `Skipped duplicate read_file: ${label} was already provided ${source} and the file has not changed. Use that earlier read_file result instead of reading it again.`,
    `already read ${label}`,
    { duplicateReadFile: true },
  );
}

export async function validateLocalFileMutationReadiness(name, args, state = createLocalToolState()) {
  const normalizedName = String(name || '');
  if (!['write_file', 'append_file', 'delete_file', 'edit', 'edit_file', 'apply_patch'].includes(normalizedName)) {
    return { ok: true };
  }
  if (state.permissionProfile === 'read-only') {
    return {
      ok: false,
      content: '当前权限配置为 read-only，不能修改工作区文件。',
      display: '当前权限配置为 read-only，不能修改工作区文件。',
    };
  }
  return { ok: true };
}

export function toolNeedsConfirmation(name) {
  return name === 'configure_mcp_server';
}

export function shellCommandRisk(command, riskLevel = '', riskReason = '', state = null) {
  const normalized = normalizeShellCommandForRisk(command);
  if (!normalized) return { needsConfirmation: false, reason: '' };
  const policy = shellPolicyDecision(command, state);
  if (policy.action === 'allow') return { needsConfirmation: false, reason: policy.reason };
  if (policy.action === 'ask') return { needsConfirmation: true, reason: policy.reason };
  if (policy.action === 'deny') return { needsConfirmation: true, reason: policy.reason };
  const declaredRisk = String(riskLevel || '').trim().toLowerCase();
  const declaredReason = String(riskReason || '').trim();
  const fallbackReason = obviousHighRiskShellReason(normalized);

  if (fallbackReason) return { needsConfirmation: true, reason: fallbackReason };
  if (declaredRisk === 'high') {
    return {
      needsConfirmation: true,
      reason: declaredReason || '模型将该命令标记为高风险。',
    };
  }
  if (declaredRisk === 'low') return { needsConfirmation: false, reason: '' };
  return { needsConfirmation: true, reason: '命令未声明风险等级。' };
}

export function summarizeToolCall(name, args, state = createLocalToolState()) {
  if (isEditToolName(name)) return `编辑 ${relativeLabel(resolvePathForDisplay(args?.file_path, state.root))}`;
  if (name === 'apply_patch') return '应用补丁';
  if (name === 'write_file') return `写入 ${relativeLabel(resolvePathForDisplay(args?.file_path, state.root))}`;
  if (name === 'append_file') return `追加到 ${relativeLabel(resolvePathForDisplay(args?.file_path, state.root))}`;
  if (name === 'delete_file') return `删除 ${relativeLabel(resolvePathForDisplay(args?.file_path, state.root))}`;
  if (name === 'configure_mcp_server') return `配置 MCP 服务 ${shortSingleLine(args?.key || '')}`;
  if (name === 'remember_memory') return `沉淀记忆 ${shortSingleLine(args?.title || args?.content || '')}`;
  if (name === 'update_plan') {
    const plan = normalizePlanItems(args?.plan);
    const active = plan.find((item) => item.status === 'in_progress')?.step;
    return active ? `更新计划：${active}` : `更新计划：${plan.length} 步`;
  }
  if (name === 'run_shell_command') {
    const label = args?.persist || args?.keep_alive ? '保持运行命令' : '运行命令';
    return `${label} ${shortSingleLine(args?.command || '')}`;
  }
  if (name === 'read_shell_process') return `读取命令进程 ${shortSingleLine(args?.process_id || '')}`;
  if (name === 'list_shell_processes') return '查看命令进程';
  if (name === 'write_shell_process') return `写入命令进程 ${shortSingleLine(args?.process_id || '')}`;
  if (name === 'terminate_shell_process') return `终止命令进程 ${shortSingleLine(args?.process_id || '')}`;
  if (name === 'search_text') return `搜索文本 ${shortSingleLine(args?.query || '')}`;
  if (name === 'find_files') return `查找文件 ${shortSingleLine(args?.query || '')}`;
  if (name === 'git_status') return '查看 Git 状态';
  if (name === 'git_log') return `查看 Git 历史 ${shortSingleLine(args?.revision || 'HEAD')}`;
  if (name === 'git_show') return `查看 Git 提交 ${shortSingleLine(args?.revision || '')}`;
  if (name === 'read_diff') return args?.staged ? '查看暂存区 diff' : '查看工作区 diff';
  if (name === 'read_file') return `查看 ${relativeLabel(resolvePathForDisplay(args?.file_path, state.root))}`;
  if (name === 'list_directory') return `查看 ${relativeLabel(resolvePathForDisplay(args?.path, state.root))}`;
  return '处理请求';
}

export async function previewWriteFileDiff(args, state = createLocalToolState()) {
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

export async function previewEditFileDiff(args, state = createLocalToolState()) {
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

export async function previewAppendFileDiff(args, state = createLocalToolState()) {
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

export async function previewDeleteFileDiff(args, state = createLocalToolState()) {
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

export async function previewApplyPatchDiff(args, state = createLocalToolState()) {
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

export async function previewMcpServerConfig(args, state = createLocalToolState()) {
  const result = await calculateMcpServerConfig(args, state);
  if (!result.ok) return { error: result.error };
  return { mcpServer: result.preview };
}

export function previewRememberMemory(args, state = createLocalToolState()) {
  return {
    memory: normalizeRememberMemoryArgs(args, state),
    storagePath: memoryStorePath(state),
  };
}

export async function executeLocalTool(name, args, state = createLocalToolState(), options = {}) {
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
    if (name === 'remember_memory') return await rememberMemory(args, state);
    if (name === 'configure_mcp_server') return await configureMcpServer(args, state);
    if (name === 'apply_patch') return await applyLocalPatch(args, state);
    if (name === 'write_file') return await writeLocalFile(args, state);
    if (name === 'append_file') return await appendLocalFile(args, state);
    if (name === 'delete_file') return await deleteLocalFile(args, state);
    if (isEditToolName(name)) return await editLocalFile(args, state);
    if (name === 'run_shell_command') return await runShellCommand(args, state, options);
    if (name === 'read_shell_process') return await readShellProcess(args, state, options);
    if (name === 'list_shell_processes') return listShellProcesses(args, state);
    if (name === 'write_shell_process') return await writeShellProcess(args, state);
    if (name === 'terminate_shell_process') return await terminateShellProcess(args, state);
    return errorResult('未知的本地操作。', {
      failure_kind: 'unknown_tool',
      failure_stage: 'validation',
    });
  } catch (error) {
    return errorResult(error.message || String(error));
  }
}

/** Run before previews as well as execution so a denied target is never read to build a diff. */
export function localFileMutationPolicyError(name, args, state = createLocalToolState()) {
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

export async function closeLocalToolState(state = createLocalToolState()) {
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

export async function cleanupLocalToolTurn(state = createLocalToolState(), context = {}) {
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
