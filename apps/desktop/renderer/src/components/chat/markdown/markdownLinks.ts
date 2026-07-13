export type MarkdownLinkTarget =
  | { kind: 'anchor'; href: string }
  | { kind: 'external'; href: string }
  | { kind: 'workspace'; line?: number; path: string }
  | { kind: 'invalid' };

export type MarkdownWorkspaceLinkTarget = Extract<MarkdownLinkTarget, { kind: 'workspace' }>;

const externalProtocolPattern = /^(?:https?:|mailto:)/i;
const unsafeProtocolPattern = /^(?:data:|javascript:|vbscript:)/i;
const windowsAbsolutePathPattern = /^[a-z]:\//i;
const markdownLocationSuffixPattern = /(?::(\d+)(?::\d+)?(?:[-–]\d+(?::\d+)?)?|#L(\d+)(?:C\d+)?(?:-L\d+(?:C\d+)?)?)$/i;
const commonWorkspaceFileExtensions = new Set([
  'bash', 'c', 'cc', 'conf', 'cpp', 'cs', 'css', 'csv', 'cxx', 'doc', 'docx', 'env', 'fish',
  'fs', 'fsx', 'gif', 'gitignore', 'go', 'gql', 'gradle', 'graphql', 'h', 'hpp', 'htm', 'html',
  'ini', 'java', 'jpeg', 'jpg', 'js', 'json', 'jsonc', 'jsx', 'kt', 'kts', 'less', 'lock', 'md',
  'mdx', 'pdf', 'php', 'png', 'properties', 'proto', 'ps1', 'py', 'pyi', 'rb', 'rs', 'sass',
  'scss', 'sh', 'sql', 'svelte', 'svg', 'swift', 'toml', 'ts', 'tsv', 'tsx', 'txt', 'vue',
  'webp', 'xls', 'xlsx', 'xml', 'yaml', 'yml', 'zsh',
]);
const extensionlessWorkspaceFileNames = new Set([
  'dockerfile', 'gemfile', 'justfile', 'license', 'makefile', 'procfile', 'rakefile', 'readme',
]);

export function markdownUrlTransform(url: string): string {
  const value = url.trim();
  if (!value || unsafeProtocolPattern.test(value)) return '';
  return value;
}

export function resolveMarkdownLinkTarget(href: string | undefined, workspaceRoot?: string): MarkdownLinkTarget {
  const rawValue = safeDecodeURIComponent(href?.trim() ?? '');
  if (!rawValue || unsafeProtocolPattern.test(rawValue)) return { kind: 'invalid' };
  if (rawValue.startsWith('#')) return { kind: 'anchor', href: rawValue };
  if (externalProtocolPattern.test(rawValue)) return { kind: 'external', href: rawValue };

  const localValue = fileUrlPath(rawValue);
  if (localValue === null) return { kind: 'invalid' };
  const normalizedLocalValue = normalizeSlashes(localValue);
  if (/^[a-z][a-z\d+.-]*:/i.test(normalizedLocalValue) && !windowsAbsolutePathPattern.test(normalizedLocalValue)) {
    return { kind: 'invalid' };
  }

  const { line, path: normalizedPath } = stripMarkdownLocation(normalizedLocalValue);
  const normalizedRoot = workspaceRoot ? trimTrailingSlash(normalizeSlashes(workspaceRoot)) : '';
  const absolute = normalizedPath.startsWith('/') || windowsAbsolutePathPattern.test(normalizedPath);

  if (absolute) {
    if (!normalizedRoot) return { kind: 'invalid' };
    const relativePath = relativeWorkspacePath(normalizedPath, normalizedRoot);
    return relativePath ? { kind: 'workspace', line, path: relativePath } : { kind: 'invalid' };
  }

  const relativePath = normalizeRelativePath(normalizedPath);
  return relativePath ? { kind: 'workspace', line, path: relativePath } : { kind: 'invalid' };
}

export function resolveMarkdownFileReference(
  value: string,
  workspaceRoot?: string,
): MarkdownWorkspaceLinkTarget | null {
  const reference = value.trim();
  if (!reference || reference.includes('\n')) return null;
  const target = resolveMarkdownLinkTarget(reference, workspaceRoot);
  if (target.kind !== 'workspace' || !looksLikeWorkspaceFile(target.path)) return null;
  return target;
}

function looksLikeWorkspaceFile(filePath: string): boolean {
  const fileName = filePath.split('/').at(-1)?.toLowerCase() ?? '';
  if (!fileName) return false;
  if (extensionlessWorkspaceFileNames.has(fileName)) return true;

  const extensionStart = fileName.lastIndexOf('.');
  if (extensionStart < 0 || extensionStart === fileName.length - 1) return false;
  const extension = fileName.slice(extensionStart + 1);
  if (commonWorkspaceFileExtensions.has(extension)) return true;

  // A path segment makes a custom extension far less likely to be a domain or version literal.
  return filePath.includes('/') && /^[a-z\d][a-z\d+_-]{0,15}$/i.test(extension);
}

function fileUrlPath(value: string): string | null {
  if (!value.toLowerCase().startsWith('file://')) return value;
  try {
    const url = new URL(value);
    const pathname = safeDecodeURIComponent(url.pathname);
    return /^\/[a-z]:\//i.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    return null;
  }
}

function stripMarkdownLocation(value: string): { line?: number; path: string } {
  const match = value.match(markdownLocationSuffixPattern);
  if (!match || match.index === undefined) return { path: value };
  const line = Number(match[1] ?? match[2]);
  return {
    line: Number.isFinite(line) ? line : undefined,
    path: value.slice(0, match.index),
  };
}

function normalizeRelativePath(value: string): string | null {
  const segments: string[] = [];
  for (const segment of value.replace(/^\.\//, '').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length ? segments.join('/') : null;
}

function relativeWorkspacePath(targetPath: string, workspaceRoot: string): string | null {
  const caseInsensitive = windowsAbsolutePathPattern.test(targetPath) || windowsAbsolutePathPattern.test(workspaceRoot);
  const comparableTarget = caseInsensitive ? targetPath.toLowerCase() : targetPath;
  const comparableRoot = caseInsensitive ? workspaceRoot.toLowerCase() : workspaceRoot;
  if (comparableTarget === comparableRoot) return null;
  const rootPrefix = comparableRoot === '/' ? '/' : `${comparableRoot}/`;
  if (!comparableTarget.startsWith(rootPrefix)) return null;
  const relativeStart = workspaceRoot === '/' ? 1 : workspaceRoot.length + 1;
  return normalizeRelativePath(targetPath.slice(relativeStart));
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
