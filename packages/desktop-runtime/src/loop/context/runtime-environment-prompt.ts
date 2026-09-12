import { runtimeText, type RuntimeInterfaceLanguage, type RuntimeEnvironment } from '@setsuna-desktop/contracts';

/** 渲染位置与路径语义，不混入实际生效的权限。 */
export function runtimeEnvironmentPrompt(environment: RuntimeEnvironment, language: RuntimeInterfaceLanguage = 'en-US'): string {
  const text = runtimeText(language);
  const roots = environment.workspaceRoots.length ? environment.workspaceRoots : [environment.workspaceRoot];
  const repository = environment.repository;
  const usesCmd = /(?:^|[\\/])cmd(?:\.exe)?$/iu.test(environment.shell ?? '');
  return [
    '<environment_context>',
    `  <environment_id>${xmlText(environment.id)}</environment_id>`,
    `  <cwd>${xmlText(environment.cwd)}</cwd>`,
    `  <workspace_root>${xmlText(environment.workspaceRoot)}</workspace_root>`,
    '  <workspace_roots>',
    ...roots.map((root) => `    <root>${xmlText(root)}</root>`),
    '  </workspace_roots>',
    environment.shell ? `  <shell>${xmlText(environment.shell)}</shell>` : '',
    ...(usesCmd ? [
      '  <shell_syntax>',
      text('    Use CMD syntax for this shell, not PowerShell or Bash syntax. Semicolons do not separate commands; issue independent commands as separate tool calls.', "    当前 shell 使用 CMD 语法，不是 PowerShell 或 Bash。分号不是命令分隔符；独立命令分开调用工具。"),
      text('    Do not assume ls, head, or tail is installed. For direct child directory names use dir /b /ad .; for source file discovery use rg --files . with appropriate -g filters.', "    不要假定已安装 ls、head 或 tail。查看直接子目录名称可用 dir /b /ad .；定位源码文件使用 rg --files . 并添加合适的 -g 筛选。"),
      text('    Use double quotes for search patterns and globs. Narrow searches and use the shell tool output budget instead of piping to head, tail, or more merely to limit output. A missing pipeline utility is not evidence that rg is missing.', "    搜索词和 glob 使用双引号。通过缩小搜索范围和 shell 工具的输出预算控制结果，不要仅为截短输出就拼接 head、tail 或 more 管道。管道工具缺失不代表 rg 缺失。"),
      '  </shell_syntax>',
    ] : []),
    repository
      ? [
          '  <repository type="git">',
          `    <root>${xmlText(repository.root)}</root>`,
          `    <workspace_prefix>${xmlText(repository.workspacePrefix)}</workspace_prefix>`,
          '  </repository>',
        ].join('\n')
      : '',
    '  <path_semantics>',
    text('    File-tool relative paths resolve from workspace_root.', "    文件工具的相对路径从 workspace_root 解析。"),
    text('    Shell commands default to cwd.', "    shell 命令默认在 cwd 执行。"),
    repository
      ? text('    Run Git from cwd; Git discovers the parent repository automatically. Do not cd to repository root or request broader access merely to inspect workspace history.', "    在 cwd 运行 Git，它会自动查找上级仓库。不要仅为了检查工作区历史就切换到仓库根目录或申请更大访问范围。")
      : '',
    repository
      ? text('    Git commands run through the shell are command-dependent and may emit repository-relative paths.', "    shell 中 Git 命令的路径语义取决于具体命令，输出可能是相对于仓库根目录的路径。")
      : '',
    repository && repository.workspacePrefix !== '.'
      ? text(`    When a shell Git command consumes a repository-relative path under ${xmlText(JSON.stringify(repository.workspacePrefix))}, either remove that prefix exactly once before using an ordinary cwd-relative pathspec, or keep the path and prefix it with :(top).`, `    shell 中 Git 命令使用位于 ${xmlText(JSON.stringify(repository.workspacePrefix))} 下的仓库相对路径时，应先且仅移除一次此前缀，作为普通 cwd 相对 pathspec 使用；或保留原路径并加上 :(top) 前缀。`)
      : '',
    repository && repository.workspacePrefix !== '.'
      ? text(`    Example: repository-relative ${xmlText(JSON.stringify(`${repository.workspacePrefix}/src/a.ts`))} becomes cwd-relative "src/a.ts"; alternatively use ${xmlText(JSON.stringify(`:(top)${repository.workspacePrefix}/src/a.ts`))}. Never pass the prefixed repository path as an ordinary cwd-relative path.`, `    例如：仓库相对路径 ${xmlText(JSON.stringify(`${repository.workspacePrefix}/src/a.ts`))} 对应 cwd 相对路径 "src/a.ts"；也可使用 ${xmlText(JSON.stringify(`:(top)${repository.workspacePrefix}/src/a.ts`))}。不要把仍含仓库前缀的路径当作普通 cwd 相对路径传入。`)
      : '',
    repository
      ? text('    Repository paths outside workspace_prefix are outside the selected workspace for file tools.', "    workspace_prefix 之外的仓库路径不属于文件工具选中的工作区。")
      : '',
    repository
      ? text('    Repository metadata describes path relationships only and does not make repository root a file-tool workspace root.', "    仓库元数据仅说明路径关系，不会把仓库根目录变成文件工具的工作区根目录。")
      : '',
    '  </path_semantics>',
    '</environment_context>',
  ].filter(Boolean).join('\n');
}

function xmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\t', '&#9;');
}
