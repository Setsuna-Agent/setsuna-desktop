import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { withFileStateUpdate } from './file-state-coordinator.js';
import { writeJsonFile } from './json-file.js';

const MEMORY_ROOT_MARKER_FILE_NAME = '.setsuna-memory-root.json';
const MEMORY_ROOT_MARKER_OWNER = 'setsuna-desktop';
const MEMORY_ROOT_MARKER_VERSION = 1;
type MemoryRootMarker = {
  owner: typeof MEMORY_ROOT_MARKER_OWNER;
  version: typeof MEMORY_ROOT_MARKER_VERSION;
  legacyImportComplete: boolean;
};

/**
 * 管理统一数据根内的 memory 目录。旧 storagePath 的导入由 Electron 维护模式
 * 在 runtime 启动前完成；运行期不会读取数据根外的 memory。
 */
export class MemoryStorageRootManager {
  constructor(private readonly dataDir: string) {}

  async activeRoot(): Promise<string> {
    return this.ensureDefaultRoot();
  }

  async allRoots(): Promise<string[]> {
    return [await this.activeRoot()];
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
    await ensureOwnedMemoryRoot(root);
    return root;
  }
}

async function ensureOwnedMemoryRoot(inputRoot: string): Promise<void> {
  const root = path.resolve(inputRoot);
  await withFileStateUpdate(path.join(root, MEMORY_ROOT_MARKER_FILE_NAME), async () => {
    const existing = await pathKind(root);
    if (existing === 'symlink') throw new Error(`Refusing to use symlinked memory root: ${root}`);
    if (existing === 'other') throw new Error(`Memory root is not a directory: ${root}`);
    if (existing === 'missing') await mkdir(root, { recursive: true });

    const marker = await readMarker(root);
    if (marker) {
      validateMarker(marker, root);
      return;
    }

    // runtime/memories was owned by Setsuna before markers existed, so legacy contents here
    // are the only non-empty unmarked root that can be claimed automatically.
    const nextMarker: MemoryRootMarker = {
      owner: MEMORY_ROOT_MARKER_OWNER,
      version: MEMORY_ROOT_MARKER_VERSION,
      legacyImportComplete: true,
    };
    await writeMarker(root, nextMarker);
  });
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

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
