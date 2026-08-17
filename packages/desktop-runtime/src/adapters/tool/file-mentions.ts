import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_SECURITY_IGNORE_FILE_NAMES } from '../search/workspace-search-policy.js';
import { isNodeError } from '../../shared/node-errors.js';

export type FileMentionEntry = {
  path: string;
  name: string;
  lowerPath: string;
  lowerName: string;
};

type FileMentionIndexCacheEntry = {
  createdAt: number;
  files: FileMentionEntry[];
  signature: string;
};

type BuildFileMentionIndexOptions = {
  force?: boolean;
};

const MAX_INDEXED_FILES = 8000;
const MAX_SUGGESTIONS = 8;
const INDEX_CACHE_TTL_MS = 5000;
const IGNORE_FILES = ['.gitignore', '.ignore', '.qwenignore', '.setsunaignore'];
const indexCache = new Map<string, FileMentionIndexCacheEntry>();

const DEFAULT_IGNORE_PATTERNS = [
  '.git/',
  '.hg/',
  '.svn/',
  '.next/',
  '.nuxt/',
  '.output/',
  '.turbo/',
  '.vite/',
  '.venv/',
  'venv/',
  'env/',
  '__pycache__/',
  '.cache/',
  '.mypy_cache/',
  '.pytest_cache/',
  '.ruff_cache/',
  'coverage/',
  'dist/',
  'build/',
  'target/',
  'node_modules/',
  '.DS_Store',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
];

export async function buildFileMentionIndex(
  root = process.cwd(),
  options: BuildFileMentionIndexOptions = {},
): Promise<FileMentionEntry[]> {
  const workspaceRoot = path.resolve(root);
  const force = Boolean(options?.force);
  const signature = await workspaceIndexSignature(workspaceRoot);
  const cached = indexCache.get(workspaceRoot);
  if (
    !force
    && cached
    && cached.signature === signature
    && Date.now() - cached.createdAt < INDEX_CACHE_TTL_MS
  ) {
    return cached.files;
  }

  const ignoreMatcher = await createWorkspaceIgnoreMatcher(workspaceRoot);
  const files: FileMentionEntry[] = [];
  await walkFiles(workspaceRoot, workspaceRoot, ignoreMatcher, files);
  indexCache.set(workspaceRoot, { createdAt: Date.now(), files, signature });
  return files;
}

export function invalidateFileMentionIndex(root = process.cwd()): void {
  indexCache.delete(path.resolve(root));
}

export function findFileMentionSuggestions(
  index: readonly FileMentionEntry[],
  query: unknown,
  limit = MAX_SUGGESTIONS,
): FileMentionEntry[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return index.slice(0, limit);

  return index
    .map((file) => ({ file, score: scoreFile(file, normalizedQuery) }))
    .filter((item) => item.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.score - right.score || left.file.path.localeCompare(right.file.path))
    .slice(0, limit)
    .map((item) => item.file);
}

export async function createWorkspaceIgnoreMatcher(
  root: string,
  options: { securityOnly?: boolean } = {},
): Promise<WorkspaceIgnoreMatcher> {
  // Security-only matchers serve include-ignored searches: they skip built-in
  // generated/secret patterns and ordinary ignore files, keeping only the
  // security-specific sources that protect arbitrarily named credential files.
  const rules = options.securityOnly ? [] : DEFAULT_IGNORE_PATTERNS.map(parseIgnoreLine).filter(isIgnoreRule);
  const fileNames = options.securityOnly ? WORKSPACE_SECURITY_IGNORE_FILE_NAMES : IGNORE_FILES;
  for (const fileName of fileNames) {
    try {
      const content = await readFile(path.join(root, fileName), 'utf8');
      rules.push(...content.split(/\r?\n/).map(parseIgnoreLine).filter(isIgnoreRule));
    } catch {
      // 忽略规则文件是可选的，缺失时不应影响工作区索引。
    }
  }
  return new WorkspaceIgnoreMatcher(rules);
}

async function walkFiles(
  root: string,
  directory: string,
  ignoreMatcher: WorkspaceIgnoreMatcher,
  files: FileMentionEntry[],
): Promise<void> {
  if (files.length >= MAX_INDEXED_FILES) return;

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  const sorted = entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  for (const entry of sorted) {
    if (files.length >= MAX_INDEXED_FILES) return;

    const absolutePath = path.join(directory, entry.name);
    const relativePath = slashPath(path.relative(root, absolutePath));
    const ignorePath = entry.isDirectory() ? `${relativePath}/` : relativePath;
    if (entry.isDirectory()) {
      if (ignoreMatcher.shouldSkipDirectory(ignorePath)) continue;
      await walkFiles(root, absolutePath, ignoreMatcher, files);
      continue;
    }
    if (!entry.isFile() || ignoreMatcher.ignores(ignorePath)) continue;

    files.push({
      path: relativePath,
      name: entry.name,
      lowerPath: normalize(relativePath),
      lowerName: normalize(entry.name),
    });
  }
}

async function workspaceIndexSignature(root: string): Promise<string> {
  const paths = [root, ...IGNORE_FILES.map((fileName) => path.join(root, fileName))];
  const parts = await Promise.all(paths.map(async (filePath) => {
    try {
      const info = await stat(filePath);
      return `${filePath}:${Math.round(info.mtimeMs)}:${info.size}`;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return `${filePath}:missing`;
      return `${filePath}:error:${isNodeError(error) ? error.code || 'unknown' : 'unknown'}`;
    }
  }));
  return parts.join('|');
}

export class WorkspaceIgnoreMatcher {
  private readonly rules: IgnoreRule[];
  private readonly negatedRules: IgnoreRule[];

  constructor(rules: IgnoreRule[]) {
    this.rules = rules;
    this.negatedRules = rules.filter((rule) => rule.negated);
  }

  ignores(relativePath: string): boolean {
    const target = normalizeIgnorePath(relativePath);
    if (!target.path) return false;
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.matches(target.path, target.directory)) ignored = !rule.negated;
    }
    return ignored;
  }

  shouldSkipDirectory(relativePath: string): boolean {
    if (!this.ignores(relativePath)) return false;
    const directory = normalizeIgnorePath(relativePath).path.replace(/\/+$/, '');
    if (!directory || !this.negatedRules.length) return true;
    return !this.negatedRules.some((rule) => rule.canReincludeInside(directory));
  }
}

function parseIgnoreLine(line: unknown): IgnoreRule | null {
  let raw = String(line || '').trim();
  if (!raw || raw.startsWith('#')) return null;
  const escapedLeading = raw.startsWith('\\#') || raw.startsWith('\\!');
  if (escapedLeading) raw = raw.slice(1);

  const negated = !escapedLeading && raw.startsWith('!');
  if (negated) raw = raw.slice(1).trim();
  if (!raw) return null;

  return new IgnoreRule(raw, negated);
}

class IgnoreRule {
  readonly original: string;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly anchored: boolean;
  readonly pattern: string;
  readonly hasSlash: boolean;
  readonly regex: RegExp;

  constructor(pattern: string, negated: boolean) {
    this.original = pattern;
    this.negated = negated;
    this.directoryOnly = pattern.endsWith('/');
    this.anchored = pattern.startsWith('/');
    this.pattern = slashPath(pattern)
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    this.hasSlash = this.pattern.includes('/');
    this.regex = globToRegExp(this.pattern);
  }

  matches(relativePath: string, isDirectory: boolean): boolean {
    const target = relativePath.replace(/^\.?\//, '').replace(/\/+$/, '');
    if (!target) return false;
    if (this.directoryOnly) return this.matchesDirectory(target, isDirectory);
    if (this.anchored || this.hasSlash) return this.regex.test(target);
    return target.split('/').some((segment) => this.regex.test(segment));
  }

  matchesDirectory(target: string, isDirectory: boolean): boolean {
    if (!isDirectory && !target.includes('/')) return false;
    if (this.anchored || this.hasSlash) {
      return this.regex.test(target) || target.startsWith(`${this.pattern}/`);
    }
    return target.split('/').some((segment) => this.regex.test(segment));
  }

  canReincludeInside(directory: string): boolean {
    if (!this.negated) return false;
    if (this.anchored || this.hasSlash) {
      return this.pattern === directory
        || this.pattern.startsWith(`${directory}/`)
        || directory.startsWith(`${this.pattern}/`);
    }
    return true;
  }
}

function isIgnoreRule(rule: IgnoreRule | null): rule is IgnoreRule {
  return rule !== null;
}

function scoreFile(file: FileMentionEntry, query: string): number {
  if (file.lowerName === query) return 0;
  if (file.lowerName.startsWith(query)) return 10 + file.name.length;
  const nameIndex = file.lowerName.indexOf(query);
  if (nameIndex >= 0) return 100 + nameIndex + file.name.length;
  if (file.lowerPath.startsWith(query)) return 300 + file.path.length;
  const pathIndex = file.lowerPath.indexOf(query);
  if (pathIndex >= 0) return 500 + pathIndex + file.path.length;
  return Number.POSITIVE_INFINITY;
}

function globToRegExp(pattern: unknown): RegExp {
  const text = String(pattern || '');
  let source = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '*') {
      if (text[index + 1] === '*') {
        if (text[index + 2] === '/') {
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
      const characterClass = parseGlobCharacterClass(text, index);
      if (characterClass) {
        source += characterClass.source;
        index = characterClass.end;
        continue;
      }
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
}

function parseGlobCharacterClass(text: string, start: number): { end: number; source: string } | null {
  let end = start + 1;
  if (text[end] === '!' || text[end] === '^') end += 1;
  if (text[end] === ']') end += 1;
  while (end < text.length && (text[end] !== ']' || text[end - 1] === '\\')) end += 1;
  if (end >= text.length) return null;

  let body = text.slice(start + 1, end);
  const negated = body.startsWith('!') || body.startsWith('^');
  if (negated) body = body.slice(1);
  if (!body) return null;
  if (body.startsWith(']')) body = `\\${body}`;

  // A glob character class never crosses a path separator, including negated classes.
  const source = negated ? `[^/${body}]` : `(?=[^/])[${body}]`;
  try {
    new RegExp(source);
  } catch {
    return null;
  }
  return { end, source };
}

function normalizeIgnorePath(value: unknown): { directory: boolean; path: string } {
  const raw = slashPath(value).replace(/^\.?\//, '');
  return {
    directory: raw.endsWith('/'),
    path: raw.replace(/\/+$/, ''),
  };
}

function slashPath(value: unknown): string {
  return String(value || '').split(path.sep).join('/').replace(/\\/g, '/');
}

function normalize(value: unknown): string {
  return String(value || '').toLowerCase();
}

function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
