import path from 'node:path';
import type { RuntimeMessage, RuntimeToolChoice, RuntimeToolDefinition, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { ToolExecutionContext, ToolExecutionPreview, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';
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
  fileChangePlanQueue: FileChangeEntry[];
  activeFileChange: FileChangeEntry | null;
};

const EXCLUDED_PC_TOOLS = new Set(['remember_memory', 'configure_mcp_server']);
const FILE_CHANGE_PLAN_TOOL_NAME = 'plan_file_changes';
const FILE_CHANGE_BEGIN_TOOL_NAME = 'begin_file_change';
const ACTUAL_FILE_MUTATION_TOOLS = new Set(['apply_patch', 'write_file', 'append_file', 'delete_file', 'edit', 'edit_file']);
const FILE_MUTATION_TOOLS = new Set([FILE_CHANGE_PLAN_TOOL_NAME, FILE_CHANGE_BEGIN_TOOL_NAME, ...ACTUAL_FILE_MUTATION_TOOLS]);

const TOOL_ALIASES: Record<string, { name: string; args: (input: Record<string, unknown>) => Record<string, unknown> }> = {
  workspace_list_directory: { name: 'list_directory', args: (input) => ({ path: input.path ?? '.' }) },
  workspace_read_file: { name: 'read_file', args: (input) => ({ ...input, file_path: input.file_path ?? input.path }) },
  workspace_search_text: { name: 'search_text', args: (input) => input },
  workspace_write_file: { name: 'write_file', args: (input) => ({ ...input, file_path: input.file_path ?? input.path }) },
};

export class PcLocalToolHost implements ToolHost {
  private readonly projectStates = new Map<string, ProjectToolState>();
  private readonly shellProcessStore = pcTools.createShellProcessStore();

  constructor(private readonly projects: WorkspaceProjectStore) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return pcTools.LOCAL_TOOL_DEFINITIONS
      .map(toRuntimeToolDefinition)
      .filter((tool): tool is RuntimeToolDefinition => Boolean(tool && !EXCLUDED_PC_TOOLS.has(tool.name)));
  }

  systemPrompt(): string {
    return pcTools.LOCAL_TOOL_SYSTEM_PROMPT;
  }

  async toolChoice(context: ToolExecutionContext, request: { tools: RuntimeToolDefinition[]; messages: RuntimeMessage[] }): Promise<RuntimeToolChoice | null> {
    const availableToolNames = new Set(request.tools.map((tool) => tool.name));
    const projectState = await this.projectStateFor(context);
    const forcedToolName = this.forcedToolName(projectState);
    if (!forcedToolName || !availableToolNames.has(forcedToolName)) return null;
    return { type: 'tool', name: forcedToolName };
  }

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

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const normalized = this.normalizeToolCall(name, input);
    if (EXCLUDED_PC_TOOLS.has(normalized.name)) throw new Error(`Unknown tool: ${name}`);
    const projectState = await this.projectStateFor(context);
    projectState.toolState.permissionProfile = context.permissionProfile ?? 'workspace-write';

    const preview = await previewForTool(normalized.name, normalized.args, projectState.toolState);
    this.validateFileChangeSequence(projectState, normalized.name, normalized.args, preview);

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
    }) as Record<string, unknown>;
    if (!result?.ok) {
      throw new Error(stringArg(result?.display || result?.content || `Local tool failed: ${normalized.name}`));
    }

    this.recordFileChangeProgress(projectState, normalized.name, normalized.args, result, preview);
    return {
      content: stringArg(result.content || result.display),
      preview: result.diff ? previewPayload(result) : preview ? previewPayload(preview) : undefined,
      data: result,
    };
  }

  private async projectStateFor(context: ToolExecutionContext): Promise<ProjectToolState> {
    const project = await this.projectFor(context.projectId);
    const root = path.resolve(project.path);
    const existing = this.projectStates.get(root);
    if (existing) {
      existing.toolState.permissionProfile = context.permissionProfile ?? 'workspace-write';
      return existing;
    }
    const toolState = pcTools.createLocalToolState(root, { shellProcessStore: this.shellProcessStore });
    toolState.permissionProfile = context.permissionProfile ?? 'workspace-write';
    const created = { root, toolState, fileChangePlanQueue: [], activeFileChange: null };
    this.projectStates.set(root, created);
    return created;
  }

  private async projectFor(projectId: unknown): Promise<WorkspaceProject> {
    const list = await this.projects.listProjects();
    const project =
      typeof projectId === 'string' && projectId
        ? list.projects.find((item) => item.id === projectId)
        : list.projects[0];
    if (!project) throw new Error('No local project is registered. Add a project before using local tools.');
    return project;
  }

  private normalizeToolCall(name: string, input: unknown): { name: string; args: Record<string, unknown> } {
    const args = recordInput(input);
    const alias = TOOL_ALIASES[name];
    if (!alias) return { name, args };
    return { name: alias.name, args: alias.args(args) };
  }

  private normalizeToolName(name: string): string {
    return TOOL_ALIASES[name]?.name ?? name;
  }

  private forcedToolName(projectState: ProjectToolState): string {
    const active = projectState.activeFileChange;
    if (active) {
      if (active.action === 'create') return 'write_file';
      if (active.action === 'append') return 'append_file';
      if (active.action === 'delete') return 'delete_file';
      return pcTools.hasRememberedReadForFile({ file_path: active.file_path }, projectState.toolState) ? '' : 'read_file';
    }
    return projectState.fileChangePlanQueue.length ? FILE_CHANGE_BEGIN_TOOL_NAME : '';
  }

  private validateFileChangeSequence(projectState: ProjectToolState, name: string, args: Record<string, unknown>, preview: unknown): void {
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

  private recordFileChangeProgress(projectState: ProjectToolState, name: string, args: Record<string, unknown>, result: Record<string, unknown>, preview: unknown): void {
    if (name === FILE_CHANGE_PLAN_TOOL_NAME) {
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

function shortSingleLine(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
