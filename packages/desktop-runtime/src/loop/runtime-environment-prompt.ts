import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';

/** Renders location and path semantics without mixing in effective permissions. */
export function runtimeEnvironmentPrompt(environment: RuntimeEnvironment): string {
  const roots = environment.workspaceRoots.length ? environment.workspaceRoots : [environment.workspaceRoot];
  const repository = environment.repository;
  return [
    '<environment_context>',
    `  <environment_id>${xmlText(environment.id)}</environment_id>`,
    `  <cwd>${xmlText(environment.cwd)}</cwd>`,
    `  <workspace_root>${xmlText(environment.workspaceRoot)}</workspace_root>`,
    '  <workspace_roots>',
    ...roots.map((root) => `    <root>${xmlText(root)}</root>`),
    '  </workspace_roots>',
    environment.shell ? `  <shell>${xmlText(environment.shell)}</shell>` : '',
    repository
      ? [
          '  <repository type="git">',
          `    <root>${xmlText(repository.root)}</root>`,
          `    <workspace_prefix>${xmlText(repository.workspacePrefix)}</workspace_prefix>`,
          '  </repository>',
        ].join('\n')
      : '',
    '  <path_semantics>',
    '    File-tool relative paths resolve from workspace_root.',
    '    Shell commands default to cwd.',
    repository
      ? '    Run Git from cwd; Git discovers the parent repository automatically. Do not cd to repository root or request broader access merely to inspect workspace history.'
      : '',
    repository
      ? '    When available, built-in git_status, read_diff, git_log, and git_show stay workspace-scoped and return workspace-relative paths.'
      : '',
    repository
      ? '    Git commands run through the shell are command-dependent and may emit repository-relative paths.'
      : '',
    repository && repository.workspacePrefix !== '.'
      ? `    When a shell Git command consumes a repository-relative path under ${xmlText(JSON.stringify(repository.workspacePrefix))}, either remove that prefix exactly once before using an ordinary cwd-relative pathspec, or keep the path and prefix it with :(top).`
      : '',
    repository && repository.workspacePrefix !== '.'
      ? `    Example: repository-relative ${xmlText(JSON.stringify(`${repository.workspacePrefix}/src/a.ts`))} becomes cwd-relative "src/a.ts"; alternatively use ${xmlText(JSON.stringify(`:(top)${repository.workspacePrefix}/src/a.ts`))}. Never pass the prefixed repository path as an ordinary cwd-relative path.`
      : '',
    repository
      ? '    Repository paths outside workspace_prefix are outside the selected workspace for file tools.'
      : '',
    repository
      ? '    Repository metadata describes path relationships only and does not make repository root a file-tool workspace root.'
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
