import { runtimeText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { spawn } from 'node:child_process';
import { ToolExecutionError, type ToolExecutionResult } from '../../../ports/tool-host.js';
import { shellOutputTokenBudgetSchema } from './pc-local-tool-definitions.js';
import { resolveWorkspacePath, workspaceRelativePath } from './pc-local-tool-paths.js';
import { ShellOutputBuffer } from './pc-local-tool-shell-output.js';
import { killChildProcess, shellEnvironment } from './pc-local-tool-shell-session-runtime.js';
import { boundedInteger } from './pc-local-tool-utils.js';

/** Only advertised in read-only turns when an OS shell sandbox is unavailable. */
export function gitInspectDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: 'git_inspect',
    description: text('Inspect workspace Git status, diff, history, or a commit without a shell. Available when read-only shell execution is unavailable. Large results can be paged with read_tool_result.', "无需 shell 即可检查工作区 Git 状态、差异、历史或提交；仅在只读 shell 不可用时提供。较长结果可用 read_tool_result 分页读取。"),
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['operation'],
      properties: {
        operation: { type: 'string', enum: ['status', 'diff', 'log', 'show'] },
        path: { type: 'string', description: text('Literal workspace path; defaults to the whole workspace.', "工作区内的字面量路径；默认整个工作区。") },
        revision: { type: 'string', description: text('Commit/ref or range for diff/log/show. Defaults to HEAD for log/show; omitted for working tree diff.', "diff/log/show 使用的提交、引用或范围。log/show 默认 HEAD；工作区差异省略此项。") },
        staged: { type: 'boolean', description: text('Compare the index for diff.', "diff 是否比较暂存区。") },
        format: { type: 'string', enum: ['patch', 'stat', 'name-only'], description: text('Diff/show output; defaults to patch.', "diff/show 输出格式；默认 patch。") },
        max_count: { type: 'integer', minimum: 1, maximum: 100, description: text('Maximum log commits; defaults to 20.', "最多返回的日志提交数；默认 20。") },
        max_output_tokens: shellOutputTokenBudgetSchema(language),
      },
    },
  };
}

const SAFE_GIT_ARGS = [
  '--no-pager', '--no-optional-locks', '--literal-pathspecs',
  '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false',
  '-c', 'status.relativePaths=true', '-c', 'protocol.allow=never',
];
const GIT_INSPECTION_TIMEOUT_MS = 30_000;

export async function inspectGit(
  input: Record<string, unknown>, root: string, signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const args = inspectionArgs(input, root);
  // Even diff/status can run repository-configured clean/process filters. Disable
  // them as well as fsmonitor, external diff, textconv, and lazy network fetches.
  const filters = await collectGit([
    ...SAFE_GIT_ARGS, 'config', '--null', '--name-only', '--get-regexp', /^filter\..*\.(clean|process|required)$/.source,
  ], root, signal);
  if (filters.exitCode !== 0 && filters.exitCode !== 1) return inspectionResult(filters);
  if (filters.omittedBytes) throw new Error('Git filter configuration exceeds the local output limit.');
  const disabledFilters = filters.stdout.split('\0').filter(Boolean).flatMap((key) => [
    '-c', `${key}=${key.endsWith('.required') ? 'false' : ''}`,
  ]);
  return inspectionResult(await collectGit([...SAFE_GIT_ARGS, ...disabledFilters, ...args], root, signal));
}

function inspectionArgs(input: Record<string, unknown>, root: string): string[] {
  const operation = input.operation;
  if (!['status', 'diff', 'log', 'show'].includes(String(operation))) throw new Error('Unsupported Git inspection operation.');
  for (const key of Object.keys(input)) {
    if (!['operation', 'path', 'revision', 'staged', 'format', 'max_count', 'max_output_tokens'].includes(key)) {
      throw new Error(`Unknown Git inspection argument: ${key}`);
    }
  }
  const target = workspaceRelativePath(resolveWorkspacePath(input.path ?? '.', root), root);
  const revision = input.revision ?? (operation === 'log' || operation === 'show' ? 'HEAD' : '');
  // No options, rev:path blob access, or shell syntax; ranges and ordinary refs
  // remain available. Paths are passed separately after -- and scoped to root.
  if (typeof revision !== 'string' || (revision && !/^[\w@][\w./~^@{}+-]*$/.test(revision))) {
    throw new Error('Expected a Git ref, commit, or range.');
  }
  if (input.format !== undefined && !['patch', 'stat', 'name-only'].includes(String(input.format))) {
    throw new Error('Unsupported Git inspection format.');
  }
  if (operation === 'status') return ['status', '--short', '--branch', '--ignore-submodules=all', '--', target];
  if (operation === 'log') return [
    'log', `--max-count=${boundedInteger(input.max_count, 20, 1, 100)}`,
    '--no-show-signature', '--format=medium', revision, '--', target,
  ];
  return [
    String(operation), '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames',
    '--relative', '--ignore-submodules=all',
    ...(operation === 'show' ? ['--no-show-signature', '--format=medium'] : []),
    ...(operation === 'diff' && input.staged === true ? ['--cached'] : []),
    ...(input.format && input.format !== 'patch' ? [`--${input.format}`] : ['--patch']),
    ...(revision ? [revision] : []), '--', target,
  ];
}

type GitOutput = ReturnType<ShellOutputBuffer['take']> & { exitCode: number | null; signal: NodeJS.Signals | null };

function inspectionResult(result: GitOutput): ToolExecutionResult {
  const content = [
    ...(result.omittedBytes ? [`Local output limit reached; ${result.omittedBytes} earlier bytes were omitted.`] : []),
    `Exit code: ${result.exitCode ?? result.signal}`,
    'Stdout:', result.stdout || '(empty)', 'Stderr:', result.stderr || '(empty)',
  ].join('\n');
  const data = { exit_code: result.exitCode, signal: result.signal };
  if (result.exitCode !== 0) throw new ToolExecutionError(content, {
    data, failureKind: 'process_exit', failureStage: 'execution',
  });
  return { content, data };
}

function collectGit(args: string[], cwd: string, signal?: AbortSignal): Promise<GitOutput> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const output = new ShellOutputBuffer();
    const child = spawn('git', args, {
      cwd, shell: false, detached: process.platform !== 'win32', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...shellEnvironment(), GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
    });
    let timedOut = false;
    const abort = () => killChildProcess(child, 'SIGKILL');
    const timer = setTimeout(() => { timedOut = true; abort(); }, GIT_INSPECTION_TIMEOUT_MS);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.setEncoding('utf8').on('data', (text: string) => output.append('stdout', text));
    child.stderr.setEncoding('utf8').on('data', (text: string) => output.append('stderr', text));
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('close', (exitCode, exitSignal) => {
      cleanup();
      if (signal?.aborted) { reject(signal.reason); return; }
      if (timedOut) {
        reject(new ToolExecutionError('Git inspection timed out.', { failureKind: 'timeout', failureStage: 'execution' }));
        return;
      }
      resolve({ ...output.take(), exitCode, signal: exitSignal });
    });
  });
}
