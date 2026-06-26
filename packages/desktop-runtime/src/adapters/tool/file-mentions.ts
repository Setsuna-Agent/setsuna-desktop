// @ts-nocheck
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_INDEXED_FILES = 8000;
const MAX_SUGGESTIONS = 8;
const INDEX_CACHE_TTL_MS = 5000;
const IGNORE_FILES = ['.gitignore', '.ignore', '.qwenignore', '.setsunaignore'];
const indexCache = new Map();

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

export async function buildFileMentionIndex(root = process.cwd(), options = {}) {
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
  const files = [];
  await walkFiles(workspaceRoot, workspaceRoot, ignoreMatcher, files);
  indexCache.set(workspaceRoot, { createdAt: Date.now(), files, signature });
  return files;
}

export function invalidateFileMentionIndex(root = process.cwd()) {
  indexCache.delete(path.resolve(root));
}

export function findFileMentionSuggestions(index, query, limit = MAX_SUGGESTIONS) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return index.slice(0, limit);

  return index
    .map((file) => ({ file, score: scoreFile(file, normalizedQuery) }))
    .filter((item) => item.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.score - right.score || left.file.path.localeCompare(right.file.path))
    .slice(0, limit)
    .map((item) => item.file);
}

export async function createWorkspaceIgnoreMatcher(root) {
  const rules = DEFAULT_IGNORE_PATTERNS.map(parseIgnoreLine).filter(Boolean);
  for (const fileName of IGNORE_FILES) {
    try {
      const content = await readFile(path.join(root, fileName), 'utf8');
      rules.push(...content.split(/\r?\n/).map(parseIgnoreLine).filter(Boolean));
    } catch {
      // Ignore files are optional; absence should not affect workspace indexing.
    }
  }
  return new WorkspaceIgnoreMatcher(rules);
}

async function walkFiles(root, directory, ignoreMatcher, files) {
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

async function workspaceIndexSignature(root) {
  const paths = [root, ...IGNORE_FILES.map((fileName) => path.join(root, fileName))];
  const parts = await Promise.all(paths.map(async (filePath) => {
    try {
      const info = await stat(filePath);
      return `${filePath}:${Math.round(info.mtimeMs)}:${info.size}`;
    } catch (error) {
      if (error?.code === 'ENOENT') return `${filePath}:missing`;
      return `${filePath}:error:${error?.code || 'unknown'}`;
    }
  }));
  return parts.join('|');
}

class WorkspaceIgnoreMatcher {
  constructor(rules) {
    this.rules = rules;
    this.negatedRules = rules.filter((rule) => rule.negated);
  }

  ignores(relativePath) {
    const target = normalizeIgnorePath(relativePath);
    if (!target.path) return false;
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.matches(target.path, target.directory)) ignored = !rule.negated;
    }
    return ignored;
  }

  shouldSkipDirectory(relativePath) {
    if (!this.ignores(relativePath)) return false;
    const directory = normalizeIgnorePath(relativePath).path.replace(/\/+$/, '');
    if (!directory || !this.negatedRules.length) return true;
    return !this.negatedRules.some((rule) => rule.canReincludeInside(directory));
  }
}

function parseIgnoreLine(line) {
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
  constructor(pattern, negated) {
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

  matches(relativePath, isDirectory) {
    const target = relativePath.replace(/^\.?\//, '').replace(/\/+$/, '');
    if (!target) return false;
    if (this.directoryOnly) return this.matchesDirectory(target, isDirectory);
    if (this.anchored || this.hasSlash) return this.regex.test(target);
    return target.split('/').some((segment) => this.regex.test(segment));
  }

  matchesDirectory(target, isDirectory) {
    if (!isDirectory && !target.includes('/')) return false;
    if (this.anchored || this.hasSlash) {
      return this.regex.test(target) || target.startsWith(`${this.pattern}/`);
    }
    return target.split('/').some((segment) => this.regex.test(segment));
  }

  canReincludeInside(directory) {
    if (!this.negated) return false;
    if (this.anchored || this.hasSlash) {
      return this.pattern === directory
        || this.pattern.startsWith(`${directory}/`)
        || directory.startsWith(`${this.pattern}/`);
    }
    return true;
  }
}

function scoreFile(file, query) {
  if (file.lowerName === query) return 0;
  if (file.lowerName.startsWith(query)) return 10 + file.name.length;
  const nameIndex = file.lowerName.indexOf(query);
  if (nameIndex >= 0) return 100 + nameIndex + file.name.length;
  if (file.lowerPath.startsWith(query)) return 300 + file.path.length;
  const pathIndex = file.lowerPath.indexOf(query);
  if (pathIndex >= 0) return 500 + pathIndex + file.path.length;
  return Number.POSITIVE_INFINITY;
}

function globToRegExp(pattern) {
  let source = '';
  for (const char of String(pattern || '')) {
    if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
}

function normalizeIgnorePath(value) {
  const raw = slashPath(value).replace(/^\.?\//, '');
  return {
    directory: raw.endsWith('/'),
    path: raw.replace(/\/+$/, ''),
  };
}

function slashPath(value) {
  return String(value || '').split(path.sep).join('/').replace(/\\/g, '/');
}

function normalize(value) {
  return String(value || '').toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
