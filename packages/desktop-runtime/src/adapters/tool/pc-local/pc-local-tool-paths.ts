/** Workspace path normalization and filesystem sandbox boundaries. */

import type {
  RuntimePermissionProfile,
  RuntimeSandboxWorkspaceWrite,
} from '@setsuna-desktop/contracts';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { protectedWorkspaceMetadataPathForPath } from '../../../security/file-system-policy.js';
import { isNodeErrorCode } from '../../../shared/node-errors.js';
import {
  parseApplyPatch,
} from './pc-local-tool-patch.js';
import {
  escapeRegExp,
} from './pc-local-tool-utils.js';

export type PcLocalPathState = {
  root?: string;
  permissionProfile?: unknown;
  sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite | null;
  directToolReadableRoots?: readonly string[];
};

export function resolveWorkspacePath(value: unknown, root?: string): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Path is required.');
  const workspaceRoot = realWorkspaceRoot(root);
  const absolutePath = path.resolve(workspaceRoot, raw);
  const targetPath = realWorkspaceTargetPath(absolutePath, workspaceRoot);
  if (!isPathInsideWorkspace(targetPath, workspaceRoot)) {
    throw new Error('路径不在当前工作区内。');
  }
  return targetPath;
}

export function resolveWorkspacePathFromBase(value: unknown, base: unknown, root?: string): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Path is required.');
  const workspaceRoot = realWorkspaceRoot(root);
  const basePath = resolveWorkspacePath(base || '.', workspaceRoot);
  const absolutePath = path.resolve(basePath, raw);
  const targetPath = realWorkspaceTargetPath(absolutePath, workspaceRoot);
  if (!isPathInsideWorkspace(targetPath, workspaceRoot)) {
    throw new Error('路径不在当前工作区内。');
  }
  return targetPath;
}

/** Resolve the parent canonically while preserving the final path component. */
export function resolveWorkspaceDeletionPath(value: unknown, root?: string): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Path is required.');
  const workspaceRoot = realWorkspaceRoot(root);
  const lexicalPath = path.resolve(workspaceRoot, raw);
  return canonicalParentTargetPath(lexicalPath, workspaceRoot);
}

export function resolveWorkspaceDeletionPathFromBase(value: unknown, base: unknown, root?: string): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Path is required.');
  const workspaceRoot = realWorkspaceRoot(root);
  const basePath = resolveWorkspacePath(base || '.', workspaceRoot);
  const lexicalPath = path.resolve(basePath, raw);
  return canonicalParentTargetPath(lexicalPath, workspaceRoot);
}

function canonicalParentTargetPath(lexicalPath: string, workspaceRoot: string): string {
  const parent = realWorkspaceTargetPath(path.dirname(lexicalPath), workspaceRoot);
  if (!isPathInsideWorkspace(parent, workspaceRoot)) throw new Error('路径不在当前工作区内。');
  return path.join(parent, path.basename(lexicalPath));
}

export function resolveReadablePath(value: unknown, state: PcLocalPathState): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Path is required.');
  const workspaceRoot = realWorkspaceRoot(state?.root);
  const absolutePath = path.resolve(workspaceRoot, raw);
  for (const root of readableRootsForState(state)) {
    const realRoot = realPathIfExists(root);
    try {
      const targetPath = realWorkspaceTargetPath(absolutePath, realRoot);
      if (isPathInsideWorkspace(targetPath, realRoot)) {
        const deniedRule = deniedSandboxRuleForPath(targetPath, state);
        if (deniedRule) throw new Error(`路径被 sandbox filesystem deny 规则拒绝：${formatAccessiblePath(targetPath, state)} (${deniedRule})`);
        return targetPath;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('sandbox filesystem deny')) throw error;
      // 尝试下一个已批准根目录；下方最终错误用于保持消息确定性。
    }
  }
  throw new Error('路径不在当前工作区或已批准 readable_roots 内。');
}

export function readableRootsForState(state: PcLocalPathState): string[] {
  const roots = sandboxReadableRootsForState(state);
  const directToolRoots = Array.isArray(state?.directToolReadableRoots)
    ? state.directToolReadableRoots
    : [];
  for (const rawRoot of directToolRoots) {
    const text = String(rawRoot || '').trim();
    if (!text) continue;
    roots.push(resolvePolicyPath(text, state?.root || process.cwd()));
  }
  return [...new Set(roots.map((root) => resolvePolicyPath(root)))];
}

export function sandboxReadableRootsForState(state: PcLocalPathState): string[] {
  const roots = [state?.root || process.cwd()];
  const configuredRoots = Array.isArray(state?.sandboxWorkspaceWrite?.readableRoots)
    ? state.sandboxWorkspaceWrite.readableRoots
    : [];
  for (const rawRoot of configuredRoots) {
    const text = String(rawRoot || '').trim();
    if (!text) continue;
    roots.push(resolvePolicyPath(text, state?.root || process.cwd()));
  }
  return [...new Set(roots.map((root) => resolvePolicyPath(root)))];
}

export function deniedRootsForState(state: PcLocalPathState): string[] {
  const configuredRoots = Array.isArray(state?.sandboxWorkspaceWrite?.deniedRoots)
    ? state.sandboxWorkspaceWrite.deniedRoots
    : [];
  const roots: string[] = [];
  for (const rawRoot of configuredRoots) {
    const text = String(rawRoot || '').trim();
    if (!text) continue;
    roots.push(...policyPathVariants(resolvePolicyPath(text, state?.root || process.cwd()), state?.root));
  }
  return [...new Set(roots)];
}

export function deniedGlobPatternsForState(state: PcLocalPathState): string[] {
  const configuredPatterns = Array.isArray(state?.sandboxWorkspaceWrite?.deniedGlobPatterns)
    ? state.sandboxWorkspaceWrite.deniedGlobPatterns
    : [];
  const patterns: string[] = [];
  for (const rawPattern of configuredPatterns) {
    const text = String(rawPattern || '').trim();
    if (!text) continue;
    let pattern = '';
    if (text.startsWith('~/')) {
      pattern = path.resolve(homedir(), text.slice(2));
    } else {
      pattern = resolvePolicyPath(text, state?.root || process.cwd());
    }
    patterns.push(pattern);
    const canonicalPattern = canonicalGlobPattern(pattern);
    if (canonicalPattern !== pattern) patterns.push(canonicalPattern);
    const equivalentPattern = workspaceEquivalentGlobPattern(pattern, state?.root);
    if (equivalentPattern && equivalentPattern !== pattern) patterns.push(equivalentPattern);
  }
  return [...new Set(patterns)];
}

function workspaceEquivalentGlobPattern(pattern: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) return '';
  const normalized = resolvePolicyPath(pattern);
  const pathApi = policyPathApi(normalized);
  const globIndex = normalized.search(/[*?[]/);
  if (globIndex < 0) return workspaceEquivalentPath(normalized, workspaceRoot);
  const fixedPrefix = normalized.slice(0, globIndex);
  const fixedRoot = /[\\/]$/.test(fixedPrefix) ? fixedPrefix.slice(0, -1) : pathApi.dirname(fixedPrefix);
  if (!fixedRoot) return '';
  const suffix = normalized.slice(fixedRoot.length);
  const equivalentRoot = workspaceEquivalentPath(fixedRoot, workspaceRoot);
  return equivalentRoot ? `${equivalentRoot}${suffix}` : '';
}

function canonicalGlobPattern(pattern: string): string {
  const normalized = resolvePolicyPath(pattern);
  const globIndex = normalized.search(/[*?[]/);
  if (globIndex < 0) return realPathIfExists(normalized);
  const fixedPrefix = normalized.slice(0, globIndex);
  const fixedRoot = fixedPrefix.endsWith(path.sep) ? fixedPrefix.slice(0, -1) : path.dirname(fixedPrefix);
  if (!fixedRoot) return normalized;
  const suffix = normalized.slice(fixedRoot.length);
  const canonicalRoot = realPathIfExists(fixedRoot);
  return `${canonicalRoot}${suffix}`;
}

export function deniedSandboxRuleForPath(filePath: string, state: PcLocalPathState): string {
  if (normalizePermissionProfile(state?.permissionProfile) === 'danger-full-access') return '';
  const targetPath = realPathIfExists(filePath);
  const deniedRoot = deniedRootsForState(state).find((root) => isPathInsideRoot(targetPath, root));
  if (deniedRoot) return deniedRoot;
  return deniedGlobPatternsForState(state).find((pattern) => globPatternMatchesPath(pattern, targetPath)) || '';
}

export function deniedRootPathForFileMutationTool(
  name: string,
  args: Record<string, unknown>,
  state: PcLocalPathState,
): string {
  for (const rawPath of fileMutationPathCandidates(name, args)) {
    try {
      const base = name === 'apply_patch' && args?.workdir ? resolveWorkspacePath(args.workdir, state.root) : state.root;
      const filePath = name === 'apply_patch'
        ? resolveWorkspacePathFromBase(rawPath, base, state.root)
        : resolveWorkspacePath(rawPath, state.root);
      if (deniedSandboxRuleForPath(filePath, state)) return formatPath(filePath, state.root);
    } catch {
      // 由常规路径校验报告格式错误或超出工作区的路径。
    }
  }
  return '';
}

export function protectedPathForFileMutationTool(
  name: string,
  args: Record<string, unknown>,
  state: PcLocalPathState,
): string {
  for (const rawPath of fileMutationPathCandidates(name, args)) {
    try {
      const base = name === 'apply_patch' && args?.workdir ? resolveWorkspacePath(args.workdir, state.root) : state.root;
      const filePath = name === 'apply_patch'
        ? resolveWorkspacePathFromBase(rawPath, base, state.root)
        : resolveWorkspacePath(rawPath, state.root);
      const protectedPath = protectedWorkspaceMetadataPathForPath(
        filePath,
        normalizePermissionProfile(state?.permissionProfile),
      );
      if (protectedPath) return formatPath(filePath, state.root);
    } catch {
      // 常规路径校验会返回更具体的路径错误。
    }
  }
  return '';
}

function globPatternMatchesPath(pattern: string, filePath: string): boolean {
  const matcher = globPatternRegExp(pattern);
  if (!matcher) return true;
  return pathCandidatesForGlob(filePath).some((candidate) => matcher.test(candidate));
}

const globPatternRegExpCache = new Map<string, RegExp | null>();

function globPatternRegExp(pattern: string): RegExp | null {
  const normalized = normalizeGlobPath(pattern);
  if (globPatternRegExpCache.has(normalized)) return globPatternRegExpCache.get(normalized) ?? null;
  try {
    const matcher = new RegExp(`^${globPatternToRegExpSource(normalized)}$`);
    globPatternRegExpCache.set(normalized, matcher);
    return matcher;
  } catch {
    // 无效的拒绝 glob 模式采用失败即拒绝的处理方式。
    globPatternRegExpCache.set(normalized, null);
    return null;
  }
}

function globPatternToRegExpSource(pattern: string): string {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
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
      const end = pattern.indexOf(']', index + 1);
      if (end > index + 1) {
        source += pattern.slice(index, end + 1);
        index = end;
      } else {
        source += '\\[';
      }
      continue;
    }
    source += escapeRegExp(char);
  }
  return source;
}

export function deniedGlobRegExpSourcesForState(state: PcLocalPathState): string[] {
  return deniedGlobPatternsForState(state).map((pattern) => `^${globPatternToRegExpSource(normalizeGlobPath(pattern))}$`);
}

function pathCandidatesForGlob(filePath: string): string[] {
  const candidates = [normalizeGlobPath(path.resolve(filePath))];
  try {
    const real = normalizeGlobPath(realpathSync(path.resolve(filePath)));
    if (!candidates.includes(real)) candidates.push(real);
  } catch {
    // 缺失路径仍需进行词法匹配，确保未来创建的被拒路径继续受到阻止。
  }
  return candidates;
}

function normalizeGlobPath(value: unknown): string {
  const normalized = stripWindowsExtendedPathPrefix(String(value || '')).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function fileMutationPathCandidates(name: string, args: Record<string, unknown>): unknown[] {
  if (name === 'apply_patch') {
    const operations = parseApplyPatch(String(args?.patch || ''));
    if (!operations.ok) return [];
    return operations.operations.flatMap((operation) => [operation.path, operation.moveTo].filter(Boolean));
  }
  return [args?.file_path ?? args?.path].filter(Boolean);
}

export function workspaceRelativePath(filePath: string, root?: string): string {
  return path.relative(realWorkspaceRoot(root), path.resolve(filePath)).replace(/\\/g, '/') || '.';
}

export function realWorkspaceRoot(root?: string | null): string {
  const workspaceRoot = path.resolve(root || process.cwd());
  try {
    return realpathSync(workspaceRoot);
  } catch {
    return workspaceRoot;
  }
}

export function realPathIfExists(filePath: string): string {
  const resolved = resolvePolicyPath(filePath);
  if (isWindowsAbsolutePolicyPath(resolved) && process.platform !== 'win32') return resolved;
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function nativeRealPathIfExists(filePath: string): string {
  const resolved = resolvePolicyPath(filePath);
  if (isWindowsAbsolutePolicyPath(resolved) && process.platform !== 'win32') return resolved;
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function realWorkspaceTargetPath(absolutePath: string, workspaceRoot: string): string {
  const resolved = path.resolve(absolutePath);
  try {
    return realpathSync(resolved);
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
  }

  const { ancestor, missingParts } = nearestExistingAncestor(resolved, workspaceRoot);
  const realAncestor = realpathSync(ancestor);
  if (!isPathInsideWorkspace(realAncestor, workspaceRoot)) {
    throw new Error('路径不在当前工作区内。');
  }
  return missingParts.reduce((current, part) => path.join(current, part), realAncestor);
}

function nearestExistingAncestor(
  targetPath: string,
  workspaceRoot: string,
): { ancestor: string; missingParts: string[] } {
  const missingParts: string[] = [];
  let current = path.resolve(targetPath);
  const root = path.parse(current).root;
  while (current && current !== root) {
    if (existsSync(current)) {
      return { ancestor: current, missingParts: missingParts.reverse() };
    }
    missingParts.push(path.basename(current));
    current = path.dirname(current);
  }
  if (existsSync(current)) return { ancestor: current, missingParts: missingParts.reverse() };
  return { ancestor: workspaceRoot, missingParts: path.relative(workspaceRoot, targetPath).split(path.sep).filter(Boolean) };
}

function isPathInsideWorkspace(filePath: string, root: string): boolean {
  const relativePath = path.relative(path.resolve(root), path.resolve(filePath));
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

export function formatPath(filePath: string, root?: string): string {
  return workspaceRelativePath(filePath, root);
}

export function formatAccessiblePath(filePath: string, state: PcLocalPathState): string {
  const workspaceRoot = realWorkspaceRoot(state?.root);
  return isPathInsideWorkspace(filePath, workspaceRoot) ? formatPath(filePath, workspaceRoot) : path.resolve(filePath);
}

export function normalizePermissionProfile(value: unknown): RuntimePermissionProfile {
  const profile = String(value || '').trim();
  if (profile === 'read-only' || profile === 'workspace-write' || profile === 'danger-full-access') return profile;
  return 'workspace-write';
}

function policyPathVariants(filePath: string, workspaceRoot: string | undefined): string[] {
  const resolved = resolvePolicyPath(filePath);
  const variants = [
    resolved,
    realPathIfExists(resolved),
    nativeRealPathIfExists(resolved),
  ];
  // Windows 临时路径可能以短名称传入，而工作区存储保留规范根目录；
  // 将现有配置路径通过工作区根目录映射回来。
  const equivalent = workspaceEquivalentPath(resolved, workspaceRoot);
  if (equivalent) {
    variants.push(equivalent, realPathIfExists(equivalent), nativeRealPathIfExists(equivalent));
  }
  return [...new Set(variants.map((item) => resolvePolicyPath(item)))];
}

function workspaceEquivalentPath(filePath: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) return '';
  const resolved = resolvePolicyPath(filePath);
  const pathApi = policyPathApi(resolved);
  const root = realWorkspaceRoot(workspaceRoot);
  if (sameExistingPath(resolved, root)) return root;
  const parts = [];
  let current = resolved;
  const parsedRoot = pathApi.parse(current).root;
  while (current && current !== parsedRoot) {
    const next = pathApi.dirname(current);
    if (next === current) break;
    parts.push(pathApi.basename(current));
    current = next;
    if (sameExistingPath(current, root)) {
      return path.join(root, ...parts.reverse());
    }
  }
  return '';
}

function sameExistingPath(left: string, right: string): boolean {
  try {
    const leftStat = statSync(left);
    const rightStat = statSync(right);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch {
    return normalizePolicyPathKey(left) === normalizePolicyPathKey(right);
  }
}

export function isPathInsideRoot(filePath: string, root: string): boolean {
  const rootKey = normalizePolicyPathKey(root);
  const fileKey = normalizePolicyPathKey(filePath);
  if (fileKey === rootKey) return true;
  return fileKey.startsWith(rootKey.endsWith('/') ? rootKey : `${rootKey}/`);
}

function normalizePolicyPath(value: unknown): string {
  const normalized = stripWindowsExtendedPathPrefix(resolvePolicyPath(String(value || '')));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function resolvePolicyPath(value: unknown, base = process.cwd()): string {
  const text = stripWindowsExtendedPathPrefix(String(value || '').trim());
  if (!text) return path.resolve(base);
  if (text.startsWith('~/')) return path.resolve(homedir(), text.slice(2));
  if (isWindowsAbsolutePolicyPath(text) && !path.isAbsolute(text)) return path.win32.normalize(text);
  if (isAbsolutePolicyPath(text)) return path.resolve(text);
  return path.resolve(base, text);
}

function isAbsolutePolicyPath(value: string): boolean {
  return path.isAbsolute(value) || isWindowsAbsolutePolicyPath(value);
}

function isWindowsAbsolutePolicyPath(value: unknown): boolean {
  return /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(String(value || ''));
}

function policyPathApi(value: string) {
  return isWindowsAbsolutePolicyPath(value) && !path.isAbsolute(value) ? path.win32 : path;
}

function normalizePolicyPathKey(value: unknown): string {
  const normalized = normalizePolicyPath(value).replace(/\\/g, '/');
  if (normalized === '/') return normalized;
  if (/^[a-z]:\/$/i.test(normalized)) return normalized;
  return normalized.replace(/\/+$/, '');
}

function stripWindowsExtendedPathPrefix(value: string): string {
  return value
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/i, '');
}
