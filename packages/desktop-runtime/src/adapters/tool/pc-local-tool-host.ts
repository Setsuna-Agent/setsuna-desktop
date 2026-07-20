import path from 'node:path';
import type {
  RuntimeBackgroundShellProcess,
  RuntimeBackgroundShellProcessTermination,
  RuntimeSandboxWorkspaceWrite,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { BackgroundShellProcessManager } from '../../ports/background-shell-process-manager.js';
import { ToolExecutionError, type ToolExecutionContext, type ToolExecutionPreview, type ToolExecutionResult, type ToolHost, type ToolTurnCleanupOutcome } from '../../ports/tool-host.js';
import type { PolicyAmendmentStore } from '../../ports/policy-amendment-store.js';
import type { WorkspaceDependencyManager } from '../../ports/workspace-dependency-manager.js';
import type { WorkspaceProjectStore } from '../../ports/workspace-project-store.js';
import { WorkspaceRuntimeEnvironmentResolver } from '../workspace/workspace-runtime-environment-resolver.js';
import { pcLocalToolPrompt } from './pc-local-tool-prompt.js';
import * as pcTools from './pc-local-tools.js';

type PcToolState = Omit<ReturnType<typeof pcTools.createLocalToolState>, 'sandboxWorkspaceWrite'> & {
  sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite;
  shellEnvironment?: Record<string, string>;
};

type ProjectToolState = {
  toolState: PcToolState;
  baseShellPolicyRules: unknown[];
};

const EXCLUDED_PC_TOOLS = new Set(['remember_memory', 'configure_mcp_server']);
const REQUEST_PERMISSIONS_TOOL_NAME = 'request_permissions';
const MAX_PERSISTENT_SHELL_TTL_MS = 6 * 60 * 60 * 1_000;
const FILE_MUTATION_TOOL_NAMES = new Set(['apply_patch', 'write_file', 'append_file', 'delete_file', 'edit', 'edit_file']);
const FILE_PATH_ARGUMENT_TOOLS = new Set(['read_file', 'write_file', 'append_file', 'delete_file', 'edit', 'edit_file']);
const CODEX_COMPAT_TOOL_DEFINITIONS: RuntimeToolDefinition[] = [
  {
    name: 'request_permissions',
    description: 'Request additional sandbox permissions for later tool calls in this turn or session.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        environment_id: { type: 'string', description: 'Optional active environment id. The desktop runtime currently supports the active local environment only.' },
        environmentId: { type: 'string', description: 'Camel-case alias for environment_id.' },
        reason: { type: 'string', description: 'User-facing reason for requesting broader permissions.' },
        permissions: {
          type: 'object',
          additionalProperties: false,
          properties: {
            network: {
              type: 'object',
              additionalProperties: false,
              properties: {
                enabled: { type: 'boolean', description: 'True requests network access.' },
              },
            },
            file_system: {
              type: 'object',
              additionalProperties: false,
              properties: {
                write: { type: 'array', items: { type: 'string' }, description: 'Absolute or workspace-relative paths to grant write access.' },
                read: { type: 'array', items: { type: 'string' }, description: 'Absolute or workspace-relative paths to grant read access.' },
                entries: {
                  type: 'array',
                  description: 'Codex canonical filesystem permission entries.',
                  items: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      access: { type: 'string', enum: ['read', 'write', 'deny'] },
                      path: {},
                    },
                  },
                },
              },
            },
            fileSystem: {
              type: 'object',
              description: 'Camel-case alias for file_system.',
              additionalProperties: true,
            },
          },
        },
      },
      required: ['permissions'],
    },
  },
  {
    name: 'exec_command',
    description: 'Run a shell command in the active local project using Codex-compatible arguments.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        shell: { type: 'string', description: 'Optional shell path. Accepted for Codex compatibility; execution uses the platform shell.' },
        cmd: { type: 'string', description: 'The shell command to run.' },
        cwd: { type: 'string', description: 'Optional working directory, absolute or relative to the project root.' },
        yield_time_ms: { type: 'integer', description: 'Milliseconds to wait before returning while the command keeps running.', minimum: 0, maximum: 30000 },
        timeout_ms: { type: 'integer', description: 'Optional timeout in milliseconds.', minimum: 1, maximum: 600000 },
        max_output_tokens: { type: 'integer', description: 'Accepted for Codex compatibility; output truncation is handled by the runtime.' },
        persist: { type: 'boolean', description: 'Keep a still-running dev server or watcher available after the current turn completes.' },
        persist_ttl_ms: { type: 'integer', description: 'Optional lifetime for a persisted process in milliseconds.', minimum: 1000, maximum: MAX_PERSISTENT_SHELL_TTL_MS },
        sandbox_permissions: { type: 'string', enum: ['use_default', 'with_additional_permissions', 'require_escalated'], description: 'Per-command sandbox override. Use with_additional_permissions only together with a non-empty additional_permissions request; otherwise omit this field or use use_default. require_escalated asks for unsandboxed execution.' },
        additional_permissions: {
          type: 'object',
          description: 'Additional sandboxed filesystem or network access for this command. Only used with sandbox_permissions set to with_additional_permissions.',
          additionalProperties: false,
          properties: {
            network: {
              type: 'object',
              additionalProperties: false,
              properties: {
                enabled: { type: 'boolean', description: 'True requests network access for this command.' },
              },
            },
            file_system: {
              type: 'object',
              additionalProperties: false,
              properties: {
                write: { type: 'array', items: { type: 'string' }, description: 'Absolute or workspace-relative paths to grant write access for this command.' },
                read: { type: 'array', items: { type: 'string' }, description: 'Absolute or workspace-relative paths to grant read access for this command.' },
              },
            },
          },
        },
        justification: { type: 'string', description: 'User-facing approval reason for require_escalated.' },
        prefix_rule: { type: 'array', items: { type: 'string' }, description: 'Reusable approval prefix accepted for Codex compatibility.' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'write_stdin',
    description: 'Write characters to an existing Codex-compatible shell session. Empty input polls the session.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        session_id: { type: ['string', 'number'], description: 'Session identifier returned by exec_command.' },
        chars: { type: 'string', description: 'Characters to write to stdin. Empty string polls for output.' },
        yield_time_ms: { type: 'integer', description: 'Milliseconds to wait for output after polling.', minimum: 0, maximum: 30000 },
        max_output_tokens: { type: 'integer', description: 'Accepted for Codex compatibility; output truncation is handled by the runtime.' },
      },
      required: ['session_id'],
    },
  },
];

const TOOL_ALIASES: Record<string, { name: string; args: (input: Record<string, unknown>) => Record<string, unknown> }> = {
  // workspace_* 名称兼容上层调用习惯，真正执行仍落到 PC local tools 的原始工具名。
  workspace_list_directory: { name: 'list_directory', args: (input) => ({ path: input.path ?? '.' }) },
  workspace_read_file: { name: 'read_file', args: (input) => ({ ...input, file_path: input.file_path ?? input.path }) },
  workspace_search_text: { name: 'search_text', args: (input) => input },
  workspace_write_file: { name: 'write_file', args: (input) => ({ ...input, file_path: input.file_path ?? input.path }) },
  exec_command: {
    name: 'run_shell_command',
    args: (input) => ({
      ...input,
      command: input.command ?? input.cmd,
      directory: input.directory ?? input.cwd,
      timeout: input.timeout ?? input.timeout_ms,
      risk_level: input.risk_level ?? input.riskLevel ?? (input.sandbox_permissions === 'require_escalated' || input.sandbox_permissions === 'with_additional_permissions' ? 'high' : 'low'),
      risk_reason: input.risk_reason ?? input.riskReason ?? input.justification,
    }),
  },
  write_stdin: {
    name: 'write_shell_process',
    args: (input) => ({
      ...input,
      process_id: input.process_id ?? input.processId ?? input.session_id,
      input: input.input ?? input.chars ?? '',
      wait_ms: input.wait_ms ?? input.yield_time_ms,
    }),
  },
};

/**
 * 将 PC local tool 实现适配到桌面 runtime 的 ToolHost 协议。
 */
export class PcLocalToolHost implements ToolHost, BackgroundShellProcessManager {
  // 每个工作区根目录维护独立状态，避免 shell 进程和已读文件串到其他项目或临时目录。
  private readonly projectStates = new Map<string, ProjectToolState>();
  // shell process store 跨项目状态复用，但执行目录和权限仍由每个 toolState 控制。
  private readonly shellProcessStore = pcTools.createShellProcessStore();
  private readonly environmentResolver: WorkspaceRuntimeEnvironmentResolver;

  constructor(
    projects: WorkspaceProjectStore,
    private readonly policyAmendmentStore?: PolicyAmendmentStore,
    private readonly workspaceDependencies?: WorkspaceDependencyManager,
  ) {
    this.environmentResolver = new WorkspaceRuntimeEnvironmentResolver(projects);
  }

  /**
   * 暴露 PC local tools 中允许模型调用的工具定义。
   *
   * @param _context ToolHost 协议参数；列工具阶段不依赖上下文。
   */
  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    const localTools = pcTools.LOCAL_TOOL_DEFINITIONS
      .map(toRuntimeToolDefinition)
      .filter((tool): tool is RuntimeToolDefinition => Boolean(tool && !EXCLUDED_PC_TOOLS.has(tool.name)));
    const names = new Set(localTools.map((tool) => tool.name));
    return [
      ...localTools,
      ...CODEX_COMPAT_TOOL_DEFINITIONS.filter((tool) => !names.has(tool.name) && toolEnabledForContext(tool.name, context)),
    ];
  }

  async environmentForToolContext(context: ToolExecutionContext) {
    if (context.environment) return context.environment;
    return this.environmentResolver.resolve({
      projectId: context.projectId,
      threadId: context.threadId,
    });
  }

  /**
   * 返回 PC local tools 的系统提示规则。
   */
  async systemPrompt(_context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): Promise<string | null> {
    const workspaceDependencies = await this.workspaceDependencies?.getPromptContext();
    return pcLocalToolPrompt(request?.tools, { workspaceDependencies });
  }

  /**
   * 判断本地工具调用是否需要用户确认。
   *
   * @param name 模型请求的工具名。
   * @param input 工具调用参数。
   * @param context 当前工具执行上下文。
   */
  async approvalForTool(name: string, input: unknown, context: ToolExecutionContext) {
    const normalized = this.normalizeToolCall(name, input);
    if (EXCLUDED_PC_TOOLS.has(normalized.name)) return null;
    const projectState = await this.projectStateFor(context);
    const toolState = this.toolStateForContext(projectState, context);
    if (FILE_MUTATION_TOOL_NAMES.has(normalized.name)) return null;
    if (normalized.name === 'run_shell_command') {
      const risk = pcTools.shellCommandRisk(
        stringArg(normalized.args.command),
        stringArg(normalized.args.risk_level ?? normalized.args.riskLevel),
        stringArg(normalized.args.risk_reason ?? normalized.args.riskReason),
        toolState as never,
      );
      if (!risk?.needsConfirmation) return null;
      return {
        reason: risk.reason || `High-risk shell command: ${shortSingleLine(normalized.args.command)}`,
        argumentsPreview: previewArguments(normalized.args),
      };
    }
    if (pcTools.toolNeedsConfirmation(normalized.name)) {
      const preview = await this.previewToolCall(normalized.name, normalized.args, context);
      return {
        reason: `本地操作需要确认：${normalized.name}`,
        argumentsPreview: preview?.argumentsPreview ?? previewArguments(normalized.args),
      };
    }
    return null;
  }

  /**
   * 生成本地工具调用的参数和结果预览。
   *
   * @param name 模型请求的工具名。
   * @param input 工具调用参数。
   * @param context 当前工具执行上下文。
   */
  async previewToolCall(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionPreview | null> {
    const normalized = this.normalizeToolCall(name, input);
    if (EXCLUDED_PC_TOOLS.has(normalized.name)) return null;
    const projectState = await this.projectStateFor(context);
    const preview = await previewForTool(normalized.name, normalized.args, this.toolStateForContext(projectState, context));
    return {
      argumentsPreview: previewArguments(normalized.args),
      ...(preview ? { resultPreview: previewPayload(preview) } : {}),
    };
  }

  /**
   * 根据未完整输出的参数生成渐进式文件变更预览。
   *
   * @param name 模型请求的工具名。
   * @param rawArguments 模型流式输出的原始 arguments 字符串。
   * @param context 当前工具执行上下文。
   */
  async previewPartialToolCall(name: string, rawArguments: string, context: ToolExecutionContext): Promise<ToolExecutionPreview | null> {
    const normalizedName = this.normalizeToolName(name);
    if (EXCLUDED_PC_TOOLS.has(normalizedName)) return null;
    const projectState = await this.projectStateFor(context);
    const toolState = this.toolStateForContext(projectState, context);
    const partialArgs = normalizePartialToolArgs(normalizedName, parsePartialArguments(normalizedName, rawArguments));
    if (!partialArgs) return null;
    const preview = partialArgs.preview ?? await previewForTool(normalizedName, partialArgs, toolState);
    return {
      argumentsPreview: previewArguments(partialArgs),
      ...(preview ? { resultPreview: previewPayload(preview) } : {}),
    };
  }

  /**
   * 执行本地工具并把 PC 工具结果适配成 ToolHost 返回值。
   *
   * @param name 模型请求的工具名。
   * @param input 工具调用参数。
   * @param context 当前工具执行上下文。
   */
  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const normalized = this.normalizeToolCall(name, input);
    if (EXCLUDED_PC_TOOLS.has(normalized.name)) throw new Error(`Unknown tool: ${name}`);
    const projectState = await this.projectStateFor(context);
    const toolState = this.toolStateForContext(projectState, context);
    const dependencyEnvironment = normalized.name === 'run_shell_command'
      ? await this.workspaceDependencies?.prepareShellEnvironment(stringArg(normalized.args.command))
      : null;
    if (dependencyEnvironment) {
      toolState.shellEnvironment = dependencyEnvironment.environment;
      toolState.sandboxWorkspaceWrite = {
        ...toolState.sandboxWorkspaceWrite,
        writableRoots: [
          ...new Set([
            ...(toolState.sandboxWorkspaceWrite?.writableRoots ?? []),
            ...dependencyEnvironment.writableRoots,
          ]),
        ],
      };
    }
    const preview = await previewForTool(normalized.name, normalized.args, toolState);
    if (context.sandbox?.networkAccess === 'enabled') {
      toolState.sandboxWorkspaceWrite = {
        ...toolState.sandboxWorkspaceWrite,
        networkAccess: true,
      };
    }
    const result = await pcTools.executeLocalTool(normalized.name, normalized.args, toolState, {
      signal: context.signal,
      threadId: context.threadId,
      turnId: context.turnId,
      toolCallId: context.toolCallId,
      onProgress: context.onToolOutputDelta
        ? (progress: Record<string, unknown>) => {
            const processId = stringArg(progress.process_id);
            const stdoutDelta = stringArg(progress.stdout_delta);
            const stderrDelta = stringArg(progress.stderr_delta);
            if (stdoutDelta) context.onToolOutputDelta?.({ delta: stdoutDelta, stream: 'stdout', processId });
            if (stderrDelta) context.onToolOutputDelta?.({ delta: stderrDelta, stream: 'stderr', processId });
          }
        : undefined,
    }) as Record<string, unknown>;
    if (!result?.ok) {
      // 面向界面的显示字符串有意保持简短。模型需要格式化后的命令输出，
      // 才能根据真实标准错误作出响应，而不是仅凭退出码猜测。
      throw new ToolExecutionError(stringArg(result?.content || result?.display || `Local tool failed: ${normalized.name}`), {
        data: result,
        failureKind: stringArg(result.failure_kind),
        failureStage: stringArg(result.failure_stage),
      });
    }

    return {
      content: stringArg(result.content || result.display),
      preview: result.diff ? previewPayload(result) : preview ? previewPayload(preview) : undefined,
      data: result,
    };
  }

  /**
   * 清理当前 turn 产生的临时本地资源。
   *
   * 持久 shell 进程由模型显式 `persist` 后跨 turn 恢复；未持久化的进程只属于当前
   * turn，完成、失败或取消时都不应继续在后台运行。
   */
  async cleanupTurn(context: ToolExecutionContext, _outcome: ToolTurnCleanupOutcome): Promise<void> {
    if (!context.turnId) return;
    const states = await this.projectStatesForCleanup(context);
    await Promise.all(states.map(async (projectState) => {
      await pcTools.cleanupLocalToolTurn(projectState.toolState, {
        threadId: context.threadId,
        turnId: context.turnId,
        toolCallId: context.toolCallId,
      });
    }));
  }

  async listBackgroundShellProcesses(threadId: string): Promise<RuntimeBackgroundShellProcess[]> {
    return pcTools.listBackgroundShellProcesses(this.shellProcessStore, threadId).map((rawProcess) => {
      const process = recordInput(rawProcess);
      return {
        id: stringArg(process.process_id),
        threadId: stringArg(process.thread_id),
        turnId: nullableString(process.turn_id),
        toolCallId: nullableString(process.tool_call_id),
        command: stringArg(process.command),
        directory: stringArg(process.directory),
        startedAt: timestampString(process.started_at_ms),
        expiresAt: nullableTimestampString(process.expires_at_ms),
      };
    });
  }

  async terminateBackgroundShellProcess(
    threadId: string,
    processId: string,
  ): Promise<RuntimeBackgroundShellProcessTermination> {
    return {
      terminated: await pcTools.terminateBackgroundShellProcess(this.shellProcessStore, threadId, processId),
    };
  }

  async shutdown(): Promise<void> {
    await pcTools.closeShellProcessStore(this.shellProcessStore);
  }

  /**
   * 获取或创建项目根目录对应的 PC local tool 状态。
   *
   * @param context 当前工具执行上下文，包含项目 ID 和权限配置。
   */
  private async projectStateFor(context: ToolExecutionContext): Promise<ProjectToolState> {
    const environment = context.environment ?? await this.environmentForToolContext(context);
    const root = path.resolve(environment.workspaceRoot);
    const existing = this.projectStates.get(root);
    if (existing) {
      await this.refreshPolicyAmendments(existing);
      return existing;
    }
    const toolState = pcTools.createLocalToolState(root, { environmentId: environment.id, shellProcessStore: this.shellProcessStore }) as PcToolState;
    const created = {
      toolState,
      baseShellPolicyRules: [...(Array.isArray(toolState.shellPolicyRules) ? toolState.shellPolicyRules : [])],
    };
    await this.refreshPolicyAmendments(created);
    this.projectStates.set(root, created);
    return created;
  }

  /**
   * 权限与沙箱字段以请求为作用域。映射和进程存储仍然共享，但异步工具调用运行期间，
   * 并发线程无法再相互覆盖实际生效的权限。
   */
  private toolStateForContext(projectState: ProjectToolState, context: ToolExecutionContext): PcToolState {
    return {
      ...projectState.toolState,
      environmentId: context.environment?.id ?? projectState.toolState.environmentId,
      permissionProfile: context.permissionProfile ?? 'workspace-write',
      sandboxWorkspaceWrite: cloneSandboxWorkspaceWrite(context.sandboxWorkspaceWrite),
      osSandbox: context.sandbox?.mode !== 'bypass',
      shellPolicyRules: [...(projectState.toolState.shellPolicyRules ?? [])],
      networkPolicyAmendments: [...(projectState.toolState.networkPolicyAmendments ?? [])],
    };
  }

  private async projectStatesForCleanup(context: ToolExecutionContext): Promise<ProjectToolState[]> {
    const environment = context.environment ?? await this.environmentForToolContext(context).catch(() => null);
    if (!environment) return [];
    const existing = this.projectStates.get(path.resolve(environment.workspaceRoot));
    return existing ? [existing] : [];
  }

  private async refreshPolicyAmendments(projectState: ProjectToolState): Promise<void> {
    const amendments = await this.policyAmendmentStore?.listPolicyAmendments().catch(() => null);
    if (!amendments) return;
    const toolState = projectState.toolState as unknown as {
      shellPolicyRules: unknown[];
      networkPolicyAmendments: unknown[];
    };
    toolState.shellPolicyRules = [
      ...projectState.baseShellPolicyRules,
      ...amendments.execPolicyAmendments.map((amendment) => ({
        action: 'allow',
        command: '',
        pattern: '',
        prefixWords: amendment,
        label: amendment.join(' '),
        sourcePath: 'runtime-policy-amendments',
        reason: `命令匹配持久 exec policy amendment：${amendment.join(' ')}`,
      })),
    ];
    toolState.networkPolicyAmendments = amendments.networkPolicyAmendments;
  }

  /**
   * 归一化工具别名和参数名。
   *
   * @param name 模型请求的工具名。
   * @param input 原始工具参数。
   */
  private normalizeToolCall(name: string, input: unknown): { name: string; args: Record<string, unknown> } {
    const args = recordInput(input);
    if (name === 'write_stdin' && !stringArg(args.input ?? args.chars)) {
      return {
        name: 'read_shell_process',
        args: {
          ...args,
          process_id: args.process_id ?? args.processId ?? args.session_id,
          wait_ms: args.wait_ms ?? args.yield_time_ms,
        },
      };
    }
    const alias = TOOL_ALIASES[name];
    if (!alias) return { name, args: normalizeDirectToolArgs(name, args) };
    const normalized = alias.args(args);
    return { name: alias.name, args: normalizeDirectToolArgs(alias.name, normalized) };
  }

  /**
   * 归一化工具名但不处理参数，用于 partial preview。
   *
   * @param name 模型请求的工具名。
   */
  private normalizeToolName(name: string): string {
    return TOOL_ALIASES[name]?.name ?? name;
  }

}

function toRuntimeToolDefinition(tool: unknown): RuntimeToolDefinition | null {
  const fn = recordInput(recordInput(tool).function);
  const name = typeof fn.name === 'string' ? fn.name : '';
  if (!name) return null;
  return {
    name,
    description: typeof fn.description === 'string' ? fn.description : '',
    inputSchema: recordInput(fn.parameters),
  };
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeDirectToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!FILE_PATH_ARGUMENT_TOOLS.has(name) || args.file_path !== undefined || args.path === undefined) return args;
  return {
    ...args,
    file_path: args.path,
  };
}

function normalizePartialToolArgs(name: string, args: Record<string, unknown> | null): Record<string, unknown> | null {
  return args ? normalizeDirectToolArgs(name, args) : null;
}

async function previewForTool(name: string, args: Record<string, unknown>, state: PcToolState): Promise<unknown> {
  if (name === 'apply_patch') return pcTools.previewApplyPatchDiff(args, state);
  if (name === 'write_file') return pcTools.previewWriteFileDiff(args, state);
  if (name === 'append_file') return pcTools.previewAppendFileDiff(args, state);
  if (name === 'delete_file') return pcTools.previewDeleteFileDiff(args, state);
  if (name === 'edit' || name === 'edit_file') return pcTools.previewEditFileDiff(args, state);
  return null;
}

function parsePartialArguments(name: string, rawArguments: string): Record<string, unknown> | null {
  const parsed =
    name === 'write_file' ? pcTools.parsePartialWriteFileArguments(rawArguments)
      : name === 'apply_patch' ? pcTools.parsePartialApplyPatchArguments(rawArguments)
        : name === 'append_file' ? pcTools.parsePartialAppendFileArguments(rawArguments)
          : name === 'delete_file' ? pcTools.parsePartialDeleteFileArguments(rawArguments)
            : (name === 'edit' || name === 'edit_file') ? pcTools.parsePartialEditFileArguments(rawArguments)
              : null;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

function previewPayload(value: unknown): string {
  const record = recordInput(value);
  const diff = record.diff ?? (isDiffLike(record) ? record : null);
  return JSON.stringify(diff ? { diff } : record);
}

function isDiffLike(value: Record<string, unknown>): boolean {
  return typeof value.path === 'string' && (typeof value.additions === 'number' || typeof value.deletions === 'number' || Array.isArray(value.diffs));
}

function previewArguments(value: unknown): string {
  return JSON.stringify(redactLongArgumentValues(value)).slice(0, 1200);
}

function redactLongArgumentValues(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...[truncated ${value.length - 500} chars]` : value;
  if (Array.isArray(value)) return value.map(redactLongArgumentValues);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactLongArgumentValues(item)]));
}

function toolEnabledForContext(name: string, context: ToolExecutionContext): boolean {
  if (name === REQUEST_PERMISSIONS_TOOL_NAME) return context.features?.request_permissions_tool !== false;
  return true;
}

function shortSingleLine(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function nullableString(value: unknown): string | null {
  const normalized = stringArg(value);
  return normalized || null;
}

function timestampString(value: unknown): string {
  const timestamp = Number(value);
  return new Date(Number.isFinite(timestamp) ? timestamp : 0).toISOString();
}

function nullableTimestampString(value: unknown): string | null {
  return value == null ? null : timestampString(value);
}

function cloneSandboxWorkspaceWrite(value: ToolExecutionContext['sandboxWorkspaceWrite']): NonNullable<ToolExecutionContext['sandboxWorkspaceWrite']> {
  return {
    ...(value ?? {}),
    ...(value?.readableRoots ? { readableRoots: [...value.readableRoots] } : {}),
    ...(value?.writableRoots ? { writableRoots: [...value.writableRoots] } : {}),
    ...(value?.deniedRoots ? { deniedRoots: [...value.deniedRoots] } : {}),
    ...(value?.deniedGlobPatterns ? { deniedGlobPatterns: [...value.deniedGlobPatterns] } : {}),
  };
}
