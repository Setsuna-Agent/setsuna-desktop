import { realpathSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const MAX_WORKSPACE_SEARCH_FILE_BYTES = 1024 * 1024;

/** Generated, dependency, and cache directories stay out of searches by default. */
export const GENERATED_WORKSPACE_SEARCH_EXCLUDE_GLOBS = [
  '**/.next/**',
  '**/.nuxt/**',
  '**/.output/**',
  '**/.turbo/**',
  '**/.vite/**',
  '**/.venv/**',
  '**/venv/**',
  '**/env/**',
  '**/__pycache__/**',
  '**/.cache/**',
  '**/.mypy_cache/**',
  '**/.pytest_cache/**',
  '**/.ruff_cache/**',
  '**/coverage/**',
  '**/dist/**',
  '**/build/**',
  '**/target/**',
  '**/node_modules/**',
  '**/release-artifacts/**',
] as const;

/**
 * VCS metadata, credential, and secret paths are never searchable, even when an
 * include-ignored search opts generated directories back in. VCS config can
 * embed credentials (for example remote URLs with tokens), and well-known
 * credential file names stay protected even when the ignore files that usually
 * hide them are lifted. This list is deliberately conservative; arbitrarily
 * named secrets still need .qwenignore/.setsunaignore protection.
 */
export const SENSITIVE_WORKSPACE_SEARCH_EXCLUDE_GLOBS = [
  '**/.git/**',
  '**/.hg/**',
  '**/.svn/**',
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/*.keystore',
  '**/.npmrc',
  '**/.netrc',
  '**/.git-credentials',
  '**/.pypirc',
  '**/.ssh/**',
  '**/.aws/credentials',
  '**/.docker/config.json',
  '**/credentials.json',
  '**/*credentials*.json',
  '**/service-account*.json',
  '**/*service-account*.json',
] as const;

export const DEFAULT_WORKSPACE_SEARCH_EXCLUDE_GLOBS = [
  ...GENERATED_WORKSPACE_SEARCH_EXCLUDE_GLOBS,
  ...SENSITIVE_WORKSPACE_SEARCH_EXCLUDE_GLOBS,
] as const;

/** Ordinary plus security-specific ignore sources consulted by default searches. */
export const WORKSPACE_IGNORE_FILE_NAMES = ['.gitignore', '.ignore', '.qwenignore', '.setsunaignore'] as const;

/**
 * Security-specific ignore sources. They protect arbitrarily named credential
 * files and stay active even for include-ignored searches.
 */
export const WORKSPACE_SECURITY_IGNORE_FILE_NAMES = ['.qwenignore', '.setsunaignore'] as const;

/**
 * Resolves the effective default exclusion layer for one search request.
 * Include-ignored searches lift generated-directory globs and ignore-file
 * rules, but sensitive file globs always stay in force.
 */
export function workspaceSearchDefaultExcludeGlobs(
  options: { includeIgnored?: boolean } = {},
): readonly string[] {
  return options.includeIgnored
    ? SENSITIVE_WORKSPACE_SEARCH_EXCLUDE_GLOBS
    : DEFAULT_WORKSPACE_SEARCH_EXCLUDE_GLOBS;
}

export async function resolveWorkspaceSearchScope(root: string, scopePath?: string) {
  const resolvedRoot = await realpath(path.resolve(root));
  const resolvedScope = await realpath(path.resolve(scopePath ?? resolvedRoot));
  if (!isPathWithin(resolvedRoot, resolvedScope)) throw new Error('Search path escapes the workspace root.');
  const scopeStat = await stat(resolvedScope);
  if (!scopeStat.isDirectory() && !scopeStat.isFile()) throw new Error('Search path is not a file or directory.');
  return { root: resolvedRoot, scopePath: resolvedScope, scopeStat };
}

export async function workspaceSearchIgnoreFiles(
  root: string,
  options: { includeIgnored?: boolean } = {},
): Promise<string[]> {
  // Root files are explicit so non-Git project folders get the same policy as repositories.
  // Include-ignored searches keep only security-specific ignore sources; ordinary ignore
  // files commonly re-exclude generated directories the search opts back into.
  const fileNames = options.includeIgnored ? WORKSPACE_SECURITY_IGNORE_FILE_NAMES : WORKSPACE_IGNORE_FILE_NAMES;
  const candidates = [...fileNames].map((name) => path.join(root, name));
  const available = await Promise.all(candidates.map(async (candidate) => {
    try {
      return (await stat(candidate)).isFile() ? candidate : null;
    } catch {
      return null;
    }
  }));
  return available.filter((candidate): candidate is string => Boolean(candidate));
}

export function ripgrepExcludeGlobs(
  root: string,
  excludeRoots: readonly string[] = [],
  excludeGlobs: readonly string[] = [],
  defaultExcludeGlobs: readonly string[] = DEFAULT_WORKSPACE_SEARCH_EXCLUDE_GLOBS,
): string[] {
  const globs: string[] = [...defaultExcludeGlobs];
  for (const excludedRoot of excludeRoots) {
    const relative = relativePolicyPath(root, excludedRoot);
    if (relative === null) continue;
    if (!relative) return ['**'];
    const literalRelative = escapeRipgrepGlobLiteral(relative);
    globs.push(`/${literalRelative}`, `/${literalRelative}/**`);
  }
  for (const excludedGlob of excludeGlobs) {
    const relative = relativePolicyGlob(root, excludedGlob);
    if (relative !== null) globs.push(relative);
  }
  return [...new Set(globs)];
}

/** Escape path characters that ripgrep would otherwise interpret as glob syntax. */
function escapeRipgrepGlobLiteral(value: string): string {
  return value.replace(/[\\*?[\]{}]/gu, '\\$&');
}

export function isWorkspaceSearchPathExcluded(
  root: string,
  filePath: string,
  excludeRoots: readonly string[] = [],
  excludeGlobs: readonly string[] = [],
  defaultExcludeGlobs: readonly string[] = DEFAULT_WORKSPACE_SEARCH_EXCLUDE_GLOBS,
): boolean {
  const absolutePath = path.resolve(filePath);
  if (!isPathWithin(root, absolutePath)) return true;
  const relativePath = slashPath(path.relative(root, absolutePath));
  const defaultExcluded = defaultExcludeGlobs.some((glob) => globMatchesPath(glob, relativePath));
  if (defaultExcluded) return true;
  if (excludeRoots.some((excludedRoot) => isPathWithin(resolvePolicyRoot(root, excludedRoot), absolutePath))) return true;
  return excludeGlobs.some((glob) => {
    const relativeGlob = relativePolicyGlob(root, glob);
    return relativeGlob !== null && globMatchesPath(relativeGlob, relativePath);
  });
}

export function workspaceRelativeSearchPath(root: string, filePath: string): string {
  const relative = slashPath(path.relative(root, path.resolve(root, filePath))).replace(/^\.\//u, '');
  if (!relative || relative === '..' || relative.startsWith('../')) {
    throw new Error(`Ripgrep returned a path outside the workspace: ${filePath}`);
  }
  return relative;
}

export function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function relativePolicyPath(root: string, value: string): string | null {
  const absolute = resolvePolicyRoot(root, value);
  if (!isPathWithin(root, absolute)) return null;
  return slashPath(path.relative(root, absolute));
}

function resolvePolicyRoot(root: string, value: string): string {
  const portableValue = path.isAbsolute(value) ? value : value.replace(/[\\/]+/gu, path.sep);
  const resolved = path.isAbsolute(portableValue) ? path.resolve(portableValue) : path.resolve(root, portableValue);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function relativePolicyGlob(root: string, value: string): string | null {
  const normalizedRoot = slashPath(path.resolve(root)).replace(/\/+$/u, '');
  const raw = slashPath(String(value).trim());
  if (!raw) return null;
  if (!isAbsoluteGlob(raw)) return raw.replace(/^\.\//u, '');
  return stripWorkspaceGlobRoot(normalizedRoot, raw)
    ?? stripWorkspaceGlobRoot(normalizedRoot, canonicalGlob(raw));
}

function stripWorkspaceGlobRoot(normalizedRoot: string, raw: string): string | null {
  const comparableRoot = process.platform === 'win32' ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparableRaw = process.platform === 'win32' ? raw.toLowerCase() : raw;
  if (comparableRaw === comparableRoot) return '**';
  if (!comparableRaw.startsWith(`${comparableRoot}/`)) return null;
  return raw.slice(normalizedRoot.length + 1);
}

function canonicalGlob(raw: string): string {
  const globIndex = raw.search(/[*?[]/u);
  const fixedPrefix = globIndex === -1 ? raw : raw.slice(0, globIndex);
  const fixedRoot = fixedPrefix.endsWith('/') ? fixedPrefix.slice(0, -1) : slashPath(path.dirname(fixedPrefix));
  if (!fixedRoot) return raw;
  try {
    const canonicalRoot = slashPath(realpathSync(fixedRoot));
    return `${canonicalRoot}${raw.slice(fixedRoot.length)}`;
  } catch {
    return raw;
  }
}

function isAbsoluteGlob(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//u.test(value);
}

function globMatchesPath(glob: string, relativePath: string): boolean {
  try {
    const normalizedGlob = glob.replace(/^\//u, '');
    return new RegExp(`^${globToRegExpSource(normalizedGlob)}$`, process.platform === 'win32' ? 'i' : '').test(relativePath);
  } catch {
    // Invalid deny patterns fail closed.
    return true;
  }
}

function globToRegExpSource(glob: string): string {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          source += '(?:[^/]+/)*';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if (char === '[') {
      const end = glob.indexOf(']', index + 1);
      if (end > index + 1) {
        source += glob.slice(index, end + 1);
        index = end;
        continue;
      }
      throw new Error('Invalid workspace search glob.');
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }
  return source;
}

function slashPath(value: string): string {
  return value.replace(/\\/gu, '/');
}
