import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectInstructionLoader, ProjectInstructionSource } from '../../ports/project-instruction-loader.js';
import { directoriesFromRoot, pathIsWithin, truncateUtf8 } from './workspace-discovery-utils.js';

const DEFAULT_MAX_BYTES = 32 * 1024;
const PRIMARY_FILENAMES = ['AGENTS.override.md', 'AGENTS.md'];

export class FileProjectInstructionLoader implements ProjectInstructionLoader {
  async load({ environment, maxBytes = DEFAULT_MAX_BYTES, fallbackFilenames = [] }: Parameters<ProjectInstructionLoader['load']>[0]): Promise<ProjectInstructionSource[]> {
    const root = await realpath(environment.workspaceRoot).catch(() => path.resolve(environment.workspaceRoot));
    const requestedCwd = await realpath(environment.cwd).catch(() => path.resolve(environment.cwd));
    const scopedCwd = pathIsWithin(root, requestedCwd) ? requestedCwd : root;
    const filenames = [...PRIMARY_FILENAMES, ...validFallbackFilenames(fallbackFilenames)];
    let remainingBytes = Math.max(0, Math.floor(maxBytes));
    const sources: ProjectInstructionSource[] = [];

    const roots = [...new Set([root, ...environment.workspaceRoots])];
    const scopes = await Promise.all(roots.map(async (sourceRoot) => {
      const canonicalRoot = await realpath(sourceRoot).catch(() => path.resolve(sourceRoot));
      return directoriesFromRoot(canonicalRoot, canonicalRoot === root ? scopedCwd : canonicalRoot)
        .map((directory) => ({ root: canonicalRoot, directory }));
    }));
    const seen = new Set<string>();
    for (const { root: sourceRoot, directory } of scopes.flat()) {
      if (seen.has(directory)) continue;
      seen.add(directory);
      if (!remainingBytes) break;
      const loaded = await readFirstInstruction(sourceRoot, directory, filenames, remainingBytes);
      if (!loaded) continue;
      const content = truncateUtf8(loaded.content.trim(), remainingBytes);
      if (!content) continue;
      const contentBytes = Buffer.byteLength(content, 'utf8');
      sources.push({
        content,
        directory,
        path: loaded.path,
        truncated: loaded.truncated || contentBytes < Buffer.byteLength(loaded.content.trim(), 'utf8'),
      });
      remainingBytes -= contentBytes;
    }
    return sources;
  }
}

async function readFirstInstruction(
  root: string,
  directory: string,
  filenames: string[],
  maxBytes: number,
): Promise<{ content: string; path: string; truncated: boolean } | null> {
  for (const filename of filenames) {
    const filePath = path.join(directory, filename);
    const resolvedPath = await realpath(filePath).catch(() => null);
    if (!resolvedPath || !pathIsWithin(root, resolvedPath)) continue;
    const loaded = await readUtf8Prefix(resolvedPath, maxBytes);
    // 内容为空的高优先级候选项不会遮蔽同目录下的 AGENTS.md 或已配置回退文件名。
    if (loaded?.content.trim()) return { ...loaded, path: resolvedPath };
  }
  return null;
}

async function readUtf8Prefix(filePath: string, maxBytes: number): Promise<{ content: string; truncated: boolean } | null> {
  const handle = await open(filePath, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return null;
    // 多读取几个字节，让 truncateUtf8 能在预算边界处完整保留一个码点。
    const readBytes = Math.min(stats.size, maxBytes + 4);
    const buffer = Buffer.alloc(readBytes);
    const result = await handle.read(buffer, 0, readBytes, 0);
    return {
      content: buffer.subarray(0, result.bytesRead).toString('utf8'),
      truncated: stats.size > maxBytes,
    };
  } finally {
    await handle.close();
  }
}

function validFallbackFilenames(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value, index, all) => Boolean(value) && path.basename(value) === value && !PRIMARY_FILENAMES.includes(value) && all.indexOf(value) === index);
}
