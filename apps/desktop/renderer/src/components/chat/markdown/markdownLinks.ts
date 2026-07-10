export type MarkdownLinkTarget =
  | { kind: 'anchor'; href: string }
  | { kind: 'external'; href: string }
  | { kind: 'workspace'; line?: number; path: string }
  | { kind: 'invalid' };

const externalProtocolPattern = /^(?:https?:|mailto:)/i;
const unsafeProtocolPattern = /^(?:data:|javascript:|vbscript:)/i;
const windowsAbsolutePathPattern = /^[a-z]:\//i;
const markdownLocationSuffixPattern = /(?::(\d+)(?::\d+)?(?:[-–]\d+(?::\d+)?)?|#L(\d+)(?:C\d+)?(?:-L\d+(?:C\d+)?)?)$/i;

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
