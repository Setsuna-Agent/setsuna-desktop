import { copyFile, lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { withFileStateUpdate } from './file-state-coordinator.js';
import { writeJsonFile } from './json-file.js';

const CUSTOM_MEMORY_DIR_NAME = '.setsuna-memory';
const MEMORY_ROOT_MARKER_FILE_NAME = '.setsuna-memory-root.json';
const MEMORY_ROOT_MARKER_OWNER = 'setsuna-desktop';
const MEMORY_ROOT_MARKER_VERSION = 1;
const LEGACY_TOP_LEVEL_FILES = [
  'memories.json',
  'MEMORY.md',
  'memory_summary.md',
  'raw_memories.md',
] as const;
const LEGACY_MEMORY_DIRECTORIES = ['rollout_summaries', 'skills'] as const;

type MemoryRootMarker = {
  owner: typeof MEMORY_ROOT_MARKER_OWNER;
  version: typeof MEMORY_ROOT_MARKER_VERSION;
  legacyImportComplete: boolean;
};

type StorageRootResolver = () => Promise<string | null | undefined> | string | null | undefined;

/**
 * 管理用户所选存储容器与 runtime 管理的记忆根目录之间的映射。
 * 破坏性操作只能在经过验证的标记目录之下执行。
 */
export class MemoryStorageRootManager {
  constructor(
    private readonly dataDir: string,
    private readonly storageRootResolver?: StorageRootResolver,
  ) {}

  async activeRoot(): Promise<string> {
    const configured = normalizeStorageRoot(await this.storageRootResolver?.());
    if (!configured) return this.ensureDefaultRoot();

    const container = path.resolve(configured);
    const root = path.join(container, CUSTOM_MEMORY_DIR_NAME);
    await ensureOwnedMemoryRoot({ root, legacyRoot: container, trustExistingContents: false });
    return root;
  }

  async allRoots(): Promise<string[]> {
    const active = await this.activeRoot();
    const fallback = await this.ensureDefaultRoot();
    return active === fallback ? [active] : [active, fallback];
  }

  async clear(root: string): Promise<void> {
    const resolved = path.resolve(root);
    await withFileStateUpdate(path.join(resolved, MEMORY_ROOT_MARKER_FILE_NAME), async () => {
      const marker = await readAndValidateMarker(resolved);
      const entries = await readdir(resolved, { withFileTypes: true });
      await Promise.all(entries
        .filter((entry) => entry.name !== MEMORY_ROOT_MARKER_FILE_NAME)
        .map((entry) => rm(path.join(resolved, entry.name), { recursive: true, force: true })));
      await writeMarker(resolved, { ...marker, legacyImportComplete: true });
    });
  }

  private async ensureDefaultRoot(): Promise<string> {
    const root = path.resolve(this.dataDir, 'memories');
    // 此路径位于 runtime 数据目录之下，并且在引入所有权标记前已由 Setsuna 管理，
    // 因此可以安全接管现有内容。
    await ensureOwnedMemoryRoot({ root, trustExistingContents: true });
    return root;
  }
}

async function ensureOwnedMemoryRoot(input: {
  root: string;
  legacyRoot?: string;
  trustExistingContents: boolean;
}): Promise<void> {
  const root = path.resolve(input.root);
  await withFileStateUpdate(path.join(root, MEMORY_ROOT_MARKER_FILE_NAME), async () => {
    const existing = await pathKind(root);
    if (existing === 'symlink') throw new Error(`Refusing to use symlinked memory root: ${root}`);
    if (existing === 'other') throw new Error(`Memory root is not a directory: ${root}`);
    if (existing === 'missing') await mkdir(root, { recursive: true });

    const marker = await readMarker(root);
    if (marker) {
      validateMarker(marker, root);
      if (!marker.legacyImportComplete && input.legacyRoot) {
        await importLegacyMemoryRoot(input.legacyRoot, root);
        await writeMarker(root, { ...marker, legacyImportComplete: true });
      }
      return;
    }

    const entries = await readdir(root);
    if (entries.length && !input.trustExistingContents) {
      throw new Error(`Refusing to claim non-empty unowned memory root: ${root}`);
    }

    const nextMarker: MemoryRootMarker = {
      owner: MEMORY_ROOT_MARKER_OWNER,
      version: MEMORY_ROOT_MARKER_VERSION,
      legacyImportComplete: !input.legacyRoot,
    };
    await writeMarker(root, nextMarker);
    if (input.legacyRoot) {
      await importLegacyMemoryRoot(input.legacyRoot, root);
      await writeMarker(root, { ...nextMarker, legacyImportComplete: true });
    }
  });
}

async function importLegacyMemoryRoot(legacyRoot: string, targetRoot: string): Promise<void> {
  const source = path.resolve(legacyRoot);
  if (source === targetRoot || !await isLegacyMemoryRoot(source)) return;

  for (const fileName of LEGACY_TOP_LEVEL_FILES) {
    await copyRegularFile(path.join(source, fileName), path.join(targetRoot, fileName));
  }
  for (const dirName of LEGACY_MEMORY_DIRECTORIES) {
    await copyRegularTree(path.join(source, dirName), path.join(targetRoot, dirName));
  }
}

async function isLegacyMemoryRoot(root: string): Promise<boolean> {
  const indexPath = path.join(root, 'memories.json');
  try {
    const stats = await lstat(indexPath);
    if (!stats.isFile() || stats.isSymbolicLink()) return false;
    const parsed = JSON.parse(await readFile(indexPath, 'utf8')) as Record<string, unknown>;
    return parsed.version === 1 && Array.isArray(parsed.memories);
  } catch {
    return false;
  }
}

async function copyRegularTree(source: string, target: string): Promise<void> {
  const kind = await pathKind(source);
  if (kind !== 'directory') return;
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) await copyRegularTree(sourcePath, targetPath);
    if (entry.isFile()) await copyRegularFile(sourcePath, targetPath);
  }
}

async function copyRegularFile(source: string, target: string): Promise<void> {
  try {
    const stats = await lstat(source);
    if (!stats.isFile() || stats.isSymbolicLink()) return;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
  }
}

async function readAndValidateMarker(root: string): Promise<MemoryRootMarker> {
  const kind = await pathKind(root);
  if (kind === 'symlink') throw new Error(`Refusing to clear symlinked memory root: ${root}`);
  if (kind !== 'directory') throw new Error(`Memory root is not a directory: ${root}`);
  const marker = await readMarker(root);
  if (!marker) throw new Error(`Refusing to clear unowned memory root: ${root}`);
  validateMarker(marker, root);
  return marker;
}

async function readMarker(root: string): Promise<MemoryRootMarker | undefined> {
  const markerPath = path.join(root, MEMORY_ROOT_MARKER_FILE_NAME);
  try {
    const stats = await lstat(markerPath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Invalid memory root marker: ${markerPath}`);
    }
    return JSON.parse(await readFile(markerPath, 'utf8')) as MemoryRootMarker;
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

function validateMarker(marker: MemoryRootMarker, root: string): void {
  if (
    marker?.owner !== MEMORY_ROOT_MARKER_OWNER
    || marker.version !== MEMORY_ROOT_MARKER_VERSION
    || typeof marker.legacyImportComplete !== 'boolean'
  ) {
    throw new Error(`Invalid memory root marker: ${root}`);
  }
}

async function writeMarker(root: string, marker: MemoryRootMarker): Promise<void> {
  await writeJsonFile(path.join(root, MEMORY_ROOT_MARKER_FILE_NAME), marker, { mode: 0o600 });
}

async function pathKind(target: string): Promise<'missing' | 'directory' | 'symlink' | 'other'> {
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) return 'symlink';
    return stats.isDirectory() ? 'directory' : 'other';
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return 'missing';
    throw error;
  }
}

function normalizeStorageRoot(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
