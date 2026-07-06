import path from 'node:path';
import type { RuntimeMessage, RuntimeToolChoice, RuntimeToolDefinition, WorkspaceProject } from '@setsuna-desktop/contracts';
import { ToolExecutionError, type ToolExecutionContext, type ToolExecutionPreview, type ToolExecutionResult, type ToolHost } from '../../ports/tool-host.js';
import type { PolicyAmendmentStore } from '../../ports/policy-amendment-store.js';
import type { WorkspaceProjectStore } from '../../ports/workspace-project-store.js';
import * as pcTools from './pc-local-tools.js';

type PcToolState = ReturnType<typeof pcTools.createLocalToolState>;

type FileChangeEntry = {
  file_path: string;
  action: 'create' | 'edit' | 'append' | 'delete';
  reason?: string;
};

type ProjectToolState = {
  root: string;
  toolState: PcToolState;
  // plan_file_changes 产出的队列，把多文件变更拆成可审计的单文件步骤。
  fileChangePlanQueue: FileChangeEntry[];
  baseShellPolicyRules: unknown[];
  // begin_file_change 后当前唯一允许写入的文件。
  activeFileChange: FileChangeEntry | null;
};

const EXCLUDED_PC_TOOLS = new Set(['remember_memory', 'configure_mcp_server']);
const FILE_CHANGE_PLAN_TOOL_NAME = 'plan_file_changes';
const FILE_CHANGE_BEGIN_TOOL_NAME = 'begin_file_change';
const REQUEST_PERMISSIONS_TOOL_NAME = 'request_permissions';
const ACTUAL_FILE_MUTATION_TOOLS = new Set(['apply_patch', 'write_file', 'append_file', 'delete_file', 'edit', 'edit_file']);
const FILE_MUTATION_TOOLS = new Set([FILE_CHANGE_PLAN_TOOL_NAME, FILE_CHANGE_BEGIN_TOOL_NAME, ...ACTUAL_FILE_MUTATION_TOOLS]);
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
        sandbox_permissions: { type: 'string', enum: ['use_default', 'with_additional_permissions', 'require_escalated'], description: 'Per-command sandbox override. with_additional_permissions uses additional_permissions after approval; require_escalated asks for unsandboxed execution.' },
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
export class PcLocalToolHost implements ToolHost {
  // 每个项目根目录维护独立状态，避免 shell 进程、已读文件和文件变更计划串到别的项目。
  private readonly projectStates = new Map<string, ProjectToolState>();
  // shell process store 跨项目状态复用，但执行目录和权限仍由每个 toolState 控制。
  private readonly shellProcessStore = pcTools.createShellProcessStore();

  constructor(
    private readonly projects: WorkspaceProjectStore,
    private readonly policyAmendmentStore?: PolicyAmendmentStore,
  ) {}

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
    const project = await this.projectFor(context.projectId);
    return {
      id: project.id,
      cwd: path.resolve(project.path),
    };
  }

  /**
   * 返回 PC local tools 的系统提示规则。
   */
  systemPrompt(): string {
    return pcTools.LOCAL_TOOL_SYSTEM_PROMPT;
  }

  /**
   * 在文件变更计划未完成时强制模型按下一步工具执行。
   *
   * @param context 当前工具执行上下文。
   * @param request 当前模型请求中的工具定义和消息上下文。
   */
  async toolChoice(context: ToolExecutionContext, request: { tools: RuntimeToolDefinition[]; messages: RuntimeMessage[] }): Promise<RuntimeToolChoice | null> {
    const availableToolNames = new Set(request.tools.map((tool) => tool.name));
    const projectState = await this.projectStateFor(context);
    const forcedToolName = this.forcedToolName(projectState);
    // 有未完成文件计划时强制下一步工具，防止模型跳过 begin/read 直接写文件。
    if (!forcedToolName || !availableToolNames.has(forcedToolName)) return null;
    return { type: 'tool', name: forcedToolName };
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
    if (FILE_MUTATION_TOOLS.has(normalized.name)) return null;
    if (normalized.name === 'run_shell_command') {
      const risk = pcTools.shellCommandRisk(
        stringArg(normalized.args.command),
        stringArg(normalized.args.risk_level ?? normalized.args.riskLevel),
        stringArg(normalized.args.risk_reason ?? normalized.args.riskReason),
        projectState.toolState as never,
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
    const preview = await previewForTool(normalized.name, normalized.args, projectState.toolState);
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
    const partialArgs = parsePartialArguments(normalizedName, rawArguments);
    if (!partialArgs) return null;
    const preview = partialArgs.preview ?? await previewForTool(normalizedName, partialArgs, projectState.toolState);
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
    projectState.toolState.permissionProfile = context.permissionProfile ?? 'workspace-write';
    projectState.toolState.sandboxWorkspaceWrite = context.sandboxWorkspaceWrite ?? {};

    const preview = await previewForTool(normalized.name, normalized.args, projectState.toolState);
    // 真正执行前再次校验文件变更顺序，避免模型绕过 preview 阶段的约束。
    this.validateFileChangeSequence(projectState, normalized.name, normalized.args, preview);

    const previousOsSandbox = Boolean(projectState.toolState.osSandbox);
    const previousSandboxWorkspaceWrite = projectState.toolState.sandboxWorkspaceWrite ?? {};
    if (context.sandbox?.mode === 'bypass') projectState.toolState.osSandbox = false;
    if (context.sandbox?.networkAccess === 'enabled') {
      projectState.toolState.sandboxWorkspaceWrite = {
        ...previousSandboxWorkspaceWrite,
        networkAccess: true,
      };
    }
    const result = await pcTools.executeLocalTool(normalized.name, normalized.args, projectState.toolState, {
      signal: context.signal,
      onProgress: context.onToolOutputDelta
        ? (progress: Record<string, unknown>) => {
            const processId = stringArg(progress.process_id);
            const stdoutDelta = stringArg(progress.stdout_delta);
            const stderrDelta = stringArg(progress.stderr_delta);
            if (stdoutDelta) context.onToolOutputDelta?.({ delta: stdoutDelta, stream: 'stdout', processId });
            if (stderrDelta) context.onToolOutputDelta?.({ delta: stderrDelta, stream: 'stderr', processId });
          }
        : undefined,
    }).finally(() => {
      projectState.toolState.osSandbox = previousOsSandbox;
      projectState.toolState.sandboxWorkspaceWrite = previousSandboxWorkspaceWrite;
    }) as Record<string, unknown>;
    if (!result?.ok) {
      throw new ToolExecutionError(stringArg(result?.display || result?.content || `Local tool failed: ${normalized.name}`), {
        data: result,
        failureKind: stringArg(result.failure_kind),
        failureStage: stringArg(result.failure_stage),
      });
    }

    this.recordFileChangeProgress(projectState, normalized.name, normalized.args, result, preview);
    return {
      content: stringArg(result.content || result.display),
      preview: result.diff ? previewPayload(result) : preview ? previewPayload(preview) : undefined,
      data: result,
    };
  }

  /**
   * 获取或创建项目根目录对应的 PC local tool 状态。
   *
   * @param context 当前工具执行上下文，包含项目 ID 和权限配置。
   */
  private async projectStateFor(context: ToolExecutionContext): Promise<ProjectToolState> {
    const project = await this.projectFor(context.projectId);
    const root = path.resolve(project.path);
    const existing = this.projectStates.get(root);
    if (existing) {
      existing.toolState.environmentId = project.id;
      existing.toolState.permissionProfile = context.permissionProfile ?? 'workspace-write';
      existing.toolState.sandboxWorkspaceWrite = context.sandboxWorkspaceWrite ?? {};
      await this.refreshPolicyAmendments(existing);
      return existing;
    }
    const toolState = pcTools.createLocalToolState(root, { environmentId: project.id, shellProcessStore: this.shellProcessStore });
    toolState.permissionProfile = context.permissionProfile ?? 'workspace-write';
    toolState.sandboxWorkspaceWrite = context.sandboxWorkspaceWrite ?? {};
    const created = {
      root,
      toolState,
      baseShellPolicyRules: [...(Array.isArray(toolState.shellPolicyRules) ? toolState.shellPolicyRules : [])],
      fileChangePlanQueue: [],
      activeFileChange: null,
    };
    await this.refreshPolicyAmendments(created);
    this.projectStates.set(root, created);
    return created;
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
   * 根据 projectId 找到当前工具调用要操作的项目。
   *
   * @param projectId 工具上下文中的项目 ID；为空时回落到第一个项目。
   */
  private async projectFor(projectId: unknown): Promise<WorkspaceProject> {
    const list = await this.projects.listProjects();
    const project =
      typeof projectId === 'string' && projectId
        ? list.projects.find((item) => item.id === projectId)
        : list.projects[0];
    if (!project) throw new Error('No local project is registered. Add a project before using local tools.');
    return project;
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
    if (!alias) return { name, args };
    return { name: alias.name, args: alias.args(args) };
  }

  /**
   * 归一化工具名但不处理参数，用于 partial preview。
   *
   * @param name 模型请求的工具名。
   */
  private normalizeToolName(name: string): string {
    return TOOL_ALIASES[name]?.name ?? name;
  }

  /**
   * 根据文件变更状态决定是否强制下一步工具。
   *
   * @param projectState 当前项目的工具状态。
   */
  private forcedToolName(projectState: ProjectToolState): string {
    const active = projectState.activeFileChange;
    if (active) {
      // edit 前要求先读文件，让模型基于当前内容生成变更，而不是凭空覆盖。
      if (active.action === 'create') return 'write_file';
      if (active.action === 'append') return 'append_file';
      if (active.action === 'delete') return 'delete_file';
      return pcTools.hasRememberedReadForFile({ file_path: active.file_path }, projectState.toolState) ? '' : 'read_file';
    }
    return projectState.fileChangePlanQueue.length ? FILE_CHANGE_BEGIN_TOOL_NAME : '';
  }

  /**
   * 校验文件变更必须按计划逐文件执行。
   *
   * @param projectState 当前项目的工具状态。
   * @param name 归一化后的工具名。
   * @param args 归一化后的工具参数。
   * @param preview 工具执行前生成的预览结果。
   */
  private validateFileChangeSequence(projectState: ProjectToolState, name: string, args: Record<string, unknown>, preview: unknown): void {
    // 模型必须先声明文件，再只写这个文件，防止一次工具调用里静默修改多个文件。
    if (name === FILE_CHANGE_BEGIN_TOOL_NAME) {
      const file = normalizeFileChangeEntry(args, projectState) ?? normalizeFileChangeEntry(preview, projectState);
      if (!file?.file_path) throw new Error('begin_file_change must include exactly one file_path before file content generation.');
      if (projectState.activeFileChange) throw new Error(`Finish the current active file first: ${projectState.activeFileChange.file_path}.`);
      const next = projectState.fileChangePlanQueue[0];
      if (!next) return;
      if (!sameRuntimeFilePath(file.file_path, next.file_path)) {
        throw new Error(`The next queued file is ${next.file_path}. Call begin_file_change for that file before any other file.`);
      }
      if (file.action && next.action && file.action !== next.action) {
        throw new Error(`The queued action for ${next.file_path} is ${next.action}. Use that action for begin_file_change.`);
      }
      return;
    }

    if (!ACTUAL_FILE_MUTATION_TOOLS.has(name)) return;
    if (name === 'apply_patch') {
      if (projectState.activeFileChange || projectState.fileChangePlanQueue.length) {
        throw new Error('Finish the current planned single-file change before applying a patch.');
      }
      return;
    }

    const active = projectState.activeFileChange;
    if (!active) {
      const next = projectState.fileChangePlanQueue[0];
      throw new Error(
        next
          ? `Call begin_file_change for ${next.file_path} before generating or writing file content. Do not batch file writes.`
          : 'Call begin_file_change for the single current file before generating or writing file content.',
      );
    }
    const paths = mutationPathsForActiveValidation(projectState, name, args, preview);
    if (paths.length !== 1) {
      throw new Error('A file mutation tool call must target exactly one file. Split the work into one begin_file_change plus one single-file mutation per file.');
    }
    const targetPath = paths[0];
    if (!sameRuntimeFilePath(targetPath, active.file_path)) {
      throw new Error(`The active file is ${active.file_path}. The mutation target was ${targetPath}. Finish the active file before moving to another file.`);
    }
    if (!fileMutationToolMatchesAction(name, active.action)) {
      throw new Error(`The active action for ${active.file_path} is ${active.action}. Use the matching single-file tool for that action.`);
    }
  }

  /**
   * 根据工具执行结果推进文件变更计划队列。
   *
   * @param projectState 当前项目的工具状态。
   * @param name 归一化后的工具名。
   * @param args 归一化后的工具参数。
   * @param result 工具实际执行结果。
   * @param preview 工具执行前生成的预览结果。
   */
  private recordFileChangeProgress(projectState: ProjectToolState, name: string, args: Record<string, unknown>, result: Record<string, unknown>, preview: unknown): void {
    if (name === FILE_CHANGE_PLAN_TOOL_NAME) {
      // 新计划会替换旧计划，确保模型重新规划后不会继续执行过期队列。
      projectState.fileChangePlanQueue = normalizeFileChangeEntries(result.planned_file_changes, projectState);
      projectState.activeFileChange = null;
      return;
    }
    if (name === FILE_CHANGE_BEGIN_TOOL_NAME) {
      projectState.activeFileChange =
        projectState.fileChangePlanQueue[0] ?? normalizeFileChangeEntry(result.current_file_change, projectState) ?? normalizeFileChangeEntry(args, projectState) ?? normalizeFileChangeEntry(preview, projectState);
      return;
    }
    if (!ACTUAL_FILE_MUTATION_TOOLS.has(name) || name === 'apply_patch') return;
    const active = projectState.activeFileChange;
    const paths = mutationPathsForActiveValidation(projectState, name, args, result.diff ?? preview);
    if (active && paths.length === 1 && sameRuntimeFilePath(paths[0], active.file_path)) {
      const index = projectState.fileChangePlanQueue.findIndex((item) => sameRuntimeFilePath(item.file_path, active.file_path));
      if (index >= 0) projectState.fileChangePlanQueue.splice(index, 1);
      projectState.activeFileChange = null;
    }
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

async function previewForTool(name: string, args: Record<string, unknown>, state: PcToolState): Promise<unknown> {
  if (name === FILE_CHANGE_PLAN_TOOL_NAME) return pcTools.previewFileChangePlan(args, state);
  if (name === FILE_CHANGE_BEGIN_TOOL_NAME) return pcTools.previewBeginFileChange(args, state);
  if (name === 'apply_patch') return pcTools.previewApplyPatchDiff(args, state);
  if (name === 'write_file') return pcTools.previewWriteFileDiff(args, state);
  if (name === 'append_file') return pcTools.previewAppendFileDiff(args, state);
  if (name === 'delete_file') return pcTools.previewDeleteFileDiff(args, state);
  if (name === 'edit' || name === 'edit_file') return pcTools.previewEditFileDiff(args, state);
  return null;
}

function parsePartialArguments(name: string, rawArguments: string): Record<string, unknown> | null {
  const parsed =
    name === FILE_CHANGE_PLAN_TOOL_NAME ? pcTools.parsePartialFileChangePlanArguments(rawArguments)
      : name === FILE_CHANGE_BEGIN_TOOL_NAME ? pcTools.parsePartialBeginFileChangeArguments(rawArguments)
        : name === 'write_file' ? pcTools.parsePartialWriteFileArguments(rawArguments)
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

function normalizeFileChangeEntries(value: unknown, projectState: ProjectToolState): FileChangeEntry[] {
  return Array.isArray(value)
    ? value.map((item) => normalizeFileChangeEntry(item, projectState)).filter((item): item is FileChangeEntry => Boolean(item))
    : [];
}

function normalizeFileChangeEntry(value: unknown, projectState: ProjectToolState): FileChangeEntry | null {
  const record = recordInput(value);
  const rawPath = record.file_path ?? record.path ?? record.target_path ?? record.file;
  const filePath = normalizeRuntimeFilePath(rawPath, projectState);
  if (!filePath) return null;
  const action = normalizeFileChangeAction(record.action);
  return {
    file_path: filePath,
    action,
    ...(typeof record.reason === 'string' && record.reason.trim() ? { reason: record.reason.trim() } : {}),
  };
}

function normalizeFileChangeAction(value: unknown): FileChangeEntry['action'] {
  const action = String(value || '').trim().toLowerCase();
  if (action === 'create' || action === 'append' || action === 'delete') return action;
  return 'edit';
}

function normalizeRuntimeFilePath(value: unknown, projectState: ProjectToolState): string {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectState.root, raw);
  const relative = path.relative(projectState.root, resolved).replace(/\\/g, '/');
  // 项目内路径统一转相对路径；项目外路径保留原样，交给权限层判断是否允许。
  if (!relative || relative === '.') return '.';
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return raw;
  return relative;
}

function sameRuntimeFilePath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/') === right.replace(/\\/g, '/');
}

function mutationPathsForActiveValidation(projectState: ProjectToolState, name: string, args: Record<string, unknown>, preview: unknown): string[] {
  if (!ACTUAL_FILE_MUTATION_TOOLS.has(name)) return [];
  const directPath = args.file_path ?? args.path ?? args.target_path ?? args.file;
  const paths = directPath ? [directPath] : mutationPreviewFiles(preview);
  return [...new Set(paths.map((item) => normalizeRuntimeFilePath(item, projectState)).filter(Boolean))];
}

function mutationPreviewFiles(preview: unknown): string[] {
  const record = recordInput(preview);
  const diff = recordInput(record.diff ?? record);
  const diffs = Array.isArray(diff.diffs) ? diff.diffs : [diff];
  return diffs.map((item) => recordInput(item).path).filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
}

function fileMutationToolMatchesAction(name: string, action: string): boolean {
  if (action === 'create') return name === 'write_file';
  if (action === 'append') return name === 'append_file';
  if (action === 'delete') return name === 'delete_file';
  return name === 'edit' || name === 'edit_file' || name === 'write_file';
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
