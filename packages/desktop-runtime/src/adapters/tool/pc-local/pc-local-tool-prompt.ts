import { runtimeText, type RuntimeInterfaceLanguage, type RuntimeToolDefinition } from '@setsuna-desktop/contracts';

export type PcLocalToolPromptOptions = {
  interfaceLanguage?: RuntimeInterfaceLanguage;
  readOnly?: boolean;
  workspaceDependencies?: {
    enabled: boolean;
  };
};

const READ_TOOL_NAMES = ['list_directory', 'find_files', 'search_text', 'read_file'] as const;
const FILE_MUTATION_TOOL_NAMES = ['apply_patch', 'edit', 'write_file', 'append_file', 'delete_file'] as const;
const SHELL_PROCESS_TOOL_NAMES = ['read_shell_process', 'list_shell_processes', 'write_shell_process', 'terminate_shell_process'] as const;
const COMPAT_TOOL_NAMES = ['request_permissions', 'exec_command', 'write_stdin'] as const;
const COMMAND_TOOL_NAMES = ['run_shell_command', 'exec_command'] as const;
const ALL_TOOL_NAMES = [
  ...READ_TOOL_NAMES,
  ...FILE_MUTATION_TOOL_NAMES,
  'update_plan',
  'run_shell_command',
  ...SHELL_PROCESS_TOOL_NAMES,
  ...COMPAT_TOOL_NAMES,
] as const;

/** 仅为当前采样步骤中声明的电脑本地工具构建策略文本。 */
export function pcLocalToolPrompt(
  tools?: RuntimeToolDefinition[],
  options: PcLocalToolPromptOptions = {},
): string | null {
  const text = runtimeText(options.interfaceLanguage);
  const advertised = new Set(tools ? tools.map((tool) => tool.name) : ALL_TOOL_NAMES);
  const localToolNames = ALL_TOOL_NAMES.filter((name) => advertised.has(name));
  if (!localToolNames.length) return null;

  const lines = [
    text('Local tools operate directly in the selected desktop workspace. Use them only when the user request depends on current workspace files, Git state, or a local command result.', "本地工具直接操作选中的桌面工作区。只有用户请求依赖当前工作区文件、Git 状态或本地命令结果时才使用。"),
    text('- For conceptual or how-to questions, answer directly without local tools.', "- 概念或使用方法类问题直接回答，无需本地工具。"),
  ];

  if (hasAny(advertised, READ_TOOL_NAMES)) {
    lines.push(
      text('- For questions about current workspace contents, inspect with read-only tools first.', "- 询问当前工作区内容时，先用只读工具检查。"),
      text('- Inspect only the files and snippets needed for the task; do not read every file or entire large files by default.', "- 只读取任务所需的文件和片段，不要默认读取所有文件或整个大文件。"),
      text('- When several read-only inspections are independent, issue their tool calls together in the same response so the runtime can execute them in parallel. Keep dependent calls sequential.', "- 多项只读检查相互独立时，在同一回复中一起调用，让运行时并行执行；有依赖的调用保持串行。"),
    );
  }

  if (advertised.has('search_text')) {
    lines.push(
      text('- Shell execution is unavailable in this turn. Use search_text for content search; it uses the runtime-managed ripgrep path and shared ignore policy.', "- 本轮无法使用 shell。内容搜索使用 search_text，它使用运行时管理的 ripgrep 路径和统一的忽略规则。"),
      text('- search_text treats query as a regular expression by default. Set regex to false only for an exact literal search.', "- search_text 默认把 query 当作正则表达式。仅在需要字面量精确搜索时设 regex 为 false。"),
      text('- When multiple search_text queries are independent, issue all of them together in the same response; do not wait for one result before issuing the next. The runtime executes the calls in parallel.', "- 多个 search_text 查询相互独立时，在同一回复中一起调用；不要等一个结果返回后才发下一个，运行时会并行执行。"),
      text('- Combine alternatives into one regular expression only when the searches share scope and options and do not need separate result attribution; otherwise keep them as separate search_text calls.', "- 只有搜索范围和选项相同、且无需区分各查询结果来源时，才把多个条件合并为一个正则表达式；否则分别调用 search_text。"),
    );
  }

  if (hasAny(advertised, FILE_MUTATION_TOOL_NAMES)) {
    if (advertised.has('apply_patch')) {
      lines.push(
        text('- Prefer apply_patch for targeted code changes so the runtime can preview and approve a cohesive multi-file patch.', "- 定向修改代码优先用 apply_patch，以便运行时预览并审批完整的多文件补丁。"),
        text('- apply_patch may create, update, or delete multiple files. Keep patches scoped and easy to review.', "- apply_patch 可以创建、更新或删除多个文件。保持补丁范围清晰、易于审阅。"),
        text('- When one requested change touches two or more related existing files, combine those edits into one apply_patch call. Do not split them into sequential full-file rewrites when a cohesive patch can express the change.', "- 同一请求涉及两个或更多相关现有文件时，把修改合并为一次 apply_patch 调用。可以用完整补丁表达时，不要拆成多次串行的整文件重写。"),
      );
    }
    const singleFileTools = ['edit', 'write_file', 'append_file', 'delete_file'].filter((name) => advertised.has(name));
    if (singleFileTools.length) {
      lines.push(text(`- ${singleFileTools.join('/')} each modify one file; choose the narrowest operation that matches the requested change.`, `- ${singleFileTools.join('/')} 每次修改一个文件；选择符合请求的最小操作。`));
    }
    const targetedEditTools = advertisedNames(advertised, ['edit', 'apply_patch']);
    if (advertised.has('write_file') && targetedEditTools.length) {
      lines.push(text(`- For an existing file, use ${targetedEditTools.join(' or ')} when they can express the change without regenerating unchanged content. Reserve write_file for new files or genuine full-file rewrites; large full-file arguments delay visible progress.`, `- 修改现有文件时，如果 ${targetedEditTools.join(' 或 ')} 能表达修改且无需重新生成未变内容，就使用它们。write_file 用于新文件或确实需要整文件重写的场景；过大的整文件参数会延迟可见进度。`));
    }
    if (advertised.has('append_file')) lines.push(text('- Use append_file for a pure append instead of simulating one with an exact replacement.', "- 纯追加内容使用 append_file，不要用精确替换模拟追加。"));
    if (advertised.has('delete_file')) lines.push(text('- Verify a requested file deletion and relevant references, then use delete_file rather than a shell deletion command.', "- 确认用户要求删除的文件及相关引用后，使用 delete_file，不要使用 shell 删除命令。"));
    lines.push(text('- Reuse conversation context when it already contains enough of the target file; avoid ritual re-reads.', "- 对话中已有足够的目标文件内容时直接复用，避免机械式重复读取。"));
  }

  if (advertised.has('git_inspect')) {
    lines.push(text('- Shell execution is unavailable in this read-only turn. Use git_inspect for status/diff/log/show, narrow by path or revision, and use read_tool_result for missing output ranges.', "- 本轮只读任务无法使用 shell。使用 git_inspect 检查 status/diff/log/show，按路径或版本缩小范围；缺失的输出范围用 read_tool_result 读取。"));
  }
  if (advertised.has('run_shell_command')) {
    lines.push(
      text('- Use run_shell_command for Git inspection, builds, tests, package-manager commands, and work that depends on command output.', "- Git 检查、构建、测试、包管理器命令以及依赖命令输出的工作，使用 run_shell_command。"),
    );
    if (!options.readOnly) lines.push(
      text('- Mark installs, destructive or high-impact commands, permission changes, sudo, remote scripts, publish/deploy, and shell redirection as high risk. If uncertain, use high risk.', "- 安装、破坏性或影响重大的命令、权限变更、sudo、远程脚本、发布/部署和 shell 重定向均标记为高风险。不确定时也使用高风险。"),
      text('- Low-risk shell commands normally run directly; high-risk commands go through runtime approval.', "- 低风险 shell 命令通常直接运行；高风险命令经过运行时审批。"),
      text('- For an explicitly requested directory removal, inspect it first. Use rmdir only for an empty directory and rm -r only when removal of its contents was explicit; classify either destructive case as high risk.', "- 用户明确要求删除目录时先检查。仅空目录可用 rmdir；只有用户明确要求删除目录内容时才可用 rm -r，两者的破坏性操作都应归为高风险。"),
    );
    if (hasAny(advertised, FILE_MUTATION_TOOL_NAMES)) {
      lines.push(text('- Use the file mutation tools for file edits; do not substitute Python, sed, awk, Perl, heredocs, redirection, rm, or unlink.', "- 文件编辑使用文件修改工具，不要用 Python、sed、awk、Perl、heredoc、重定向、rm 或 unlink 代替。"));
    }
  }

  if (hasAny(advertised, COMMAND_TOOL_NAMES)) {
    if (options.readOnly) lines.push(text('- This turn permits read-only inspection. Shell commands have no write or network access; permission expansion and unsandboxed retries are unavailable.', "- 本轮仅允许只读检查。shell 命令没有写入或网络权限，也不能扩权或在沙箱外重试。"));
    lines.push(
      text('- Search file contents with rg and discover files with rg --files. The desktop runtime puts its managed ripgrep on PATH. Choose the paths, globs (-g), file-name output (-l), counts (-c), or context (-A/-B/-C) needed for the task; narrow large searches before reading their output. If rg is unavailable, use the available platform commands.', "- 文件内容搜索使用 rg，查找文件使用 rg --files。桌面运行时已将托管的 ripgrep 加入 PATH。按任务选择路径、glob（-g）、仅文件名（-l）、计数（-c）或上下文（-A/-B/-C）；大型搜索先缩小范围再读取输出。rg 不可用时使用当前平台的可用命令。"),
      text('- rg follows its native ignore rules. Use --hidden for hidden files or --no-ignore for ignored files when needed; use --ignore-file for project-specific ignore files such as .setsunaignore. Quote patterns and globs for the platform shell (double quotes on Windows). Exit code 1 means no matches, not a search failure.', "- rg 遵循自身的忽略规则。需要时用 --hidden 搜索隐藏文件、--no-ignore 搜索被忽略文件；.setsunaignore 等项目专用忽略文件通过 --ignore-file 指定。按当前平台 shell 为搜索词和 glob 加引号（Windows 使用双引号）。退出码 1 表示没有匹配，不代表搜索执行失败。"),
      text('- Inspect Git through the shell. Start with status, --stat, or --name-only when useful, then request the relevant paths or revisions; avoid dumping a whole large patch by default.', "- 通过 shell 检查 Git。适合时先看 status、--stat 或 --name-only，再请求相关路径或版本；不要默认输出整个大补丁。"),
      text('- max_output_tokens controls the visible shell output within the runtime policy limit. When a result includes result_id, use read_tool_result for missing ranges instead of rerunning the command.', "- max_output_tokens 在运行时策略上限内控制可见的 shell 输出。结果包含 result_id 时，用 read_tool_result 读取缺失范围，不要重新运行命令。"),
      text('- Before the first build, test, lint, or typecheck command, use the injected project workflow. If it is unavailable or insufficient, inspect project instructions, the nearest relevant manifest, lockfile, and workspace configuration with read-only tools first.', "- 第一次执行 build、test、lint 或 typecheck 前，使用注入的项目工作流。工作流缺失或不足时，先用只读工具查看项目指令、最近的相关清单、锁文件和工作区配置。"),
      text('- Never use npm, npx, or another package-manager command as a probe when repository evidence selects a different manager. Prefer declared scripts; invoke a runner directly only when no declared script covers the check.', "- 仓库证据已经确定包管理器时，不要用 npm、npx 或其他包管理器命令试探。优先用声明的脚本；仅在没有脚本覆盖该检查时才直接调用执行器。"),
      text('- When deriving a narrower validation command from a declared script, preserve its package manager, working directory, runner flags, and configuration.', "- 从声明脚本派生更小范围的验证命令时，保留原包管理器、工作目录、执行器参数和配置。"),
    );
    if (options.workspaceDependencies?.enabled) {
      lines.push(
        text('- The desktop runtime manages and prepends Node.js, Python 3, pip, and uv for shell commands. Use python3 or uv directly; do not run which, command -v, or version probes first unless a command actually fails and you are diagnosing it.', "- 桌面运行时已管理 Node.js、Python 3、pip 和 uv，并加入 shell 路径。直接使用 python3 或 uv；除非命令确实失败且需要诊断，否则不要先运行 which、command -v 或版本探测。"),
        text('- The configured npm registry is already applied to npm, pnpm, and Corepack. Do not add a different --registry or bypass it.', "- 配置的 npm 镜像已应用于 npm、pnpm 和 Corepack，不要另加 --registry 或绕过它。"),
        text('- The configured Python package index is already applied to both pip and uv. Do not add a different --index-url or bypass it.', "- 配置的 Python 包索引已应用于 pip 和 uv，不要另加 --index-url 或绕过它。"),
        text('- The managed pip and pip3 commands are uv-backed compatibility shims and require an active virtual environment. Do not run a bare pip install for one-off work.', "- 托管的 pip 和 pip3 是基于 uv 的兼容命令，需要已激活的虚拟环境。一次性任务不要直接运行 pip install。"),
        text('- Never install into the system Python or user site. For one-off dependencies, run the complete task in an isolated command such as uv run --with <package> -- python <script>; for a declared Python project, follow its existing uv or virtual-environment workflow.', "- 不要安装到系统 Python 或用户 site 目录。一次性依赖应在隔离命令中完成整个任务，例如 uv run --with <package> -- python <script>；已有 Python 项目遵循现有 uv 或虚拟环境工作流。"),
      );
    } else {
      lines.push(text('- Before installing Python dependencies, inspect the project files and use command -v uv only when availability is genuinely unknown. Prefer the project-declared uv workflow when available; never install into the system Python or user site. Use a workspace .venv or an ephemeral uv run --with environment.', "- 安装 Python 依赖前先看项目文件，只有确实不知道 uv 是否可用时才使用 command -v uv。优先遵循项目声明的 uv 工作流；不要安装到系统 Python 或用户 site 目录，使用工作区 .venv 或临时 uv run --with 环境。"));
    }
  }

  if (hasAny(advertised, SHELL_PROCESS_TOOL_NAMES)) {
    lines.push(text('- A long-running shell command may return a process id. Use the advertised shell-process tools to poll, write interactive input, or terminate it as needed. Polls return only output not already returned by an earlier tool call.', "- 长时间运行的 shell 命令可能返回进程 ID。按需使用已公布的进程工具轮询、写入交互输入或终止进程。轮询只返回之前调用尚未返回的输出。"));
  }
  if (advertised.has('update_plan')) {
    lines.push(text('- For multi-step tasks, keep a concise plan with exactly one step in progress and update it as work completes.', "- 多步骤任务维护简洁计划，恰好一个步骤处于进行中，并随工作完成更新状态。"));
  }
  if (advertised.has('exec_command')) {
    lines.push(text('- exec_command is the shell execution surface.', "- exec_command 是 shell 执行入口。"));
    if (!options.readOnly) lines.push(
      text('- Request only the narrowest per-command sandbox override when broader access is necessary.', "- 需要更广访问范围时，仅申请当前命令所需的最小沙箱权限扩展。"),
      text('- If an important exec_command fails with a likely sandbox or permission error and narrow filesystem or network grants are insufficient, retry the same command with sandbox_permissions set to require_escalated and a concise justification so the runtime can request unsandboxed execution. Do not skip required build, test, lint, or typecheck validation solely because the sandboxed attempt failed.', "- 重要的 exec_command 疑似因沙箱或权限失败，且精确的文件系统或网络授权仍不足时，用相同命令重试，将 sandbox_permissions 设为 require_escalated，并提供简短 justification，让运行时请求沙箱外执行。不要仅因沙箱内执行失败就跳过必要的 build、test、lint 或 typecheck。"),
    );
  }
  if (advertised.has('write_stdin')) {
    lines.push(text('- Use write_stdin only with an existing compatible shell session id; empty input polls the session.', "- write_stdin 只能用于已有且兼容的 shell 会话 ID；空输入用于轮询会话。"));
  }

  lines.push(
    text('- Keep paths inside the effective readable and writable roots unless the runtime grants additional access.', "- 除非运行时授予额外访问权限，否则路径必须位于有效的可读、可写根目录内。"),
  );
  return lines.join('\n');
}

function hasAny(names: ReadonlySet<string>, candidates: readonly string[]): boolean {
  return candidates.some((name) => names.has(name));
}

function advertisedNames(names: ReadonlySet<string>, candidates: readonly string[]): string[] {
  return candidates.filter((name) => names.has(name));
}
