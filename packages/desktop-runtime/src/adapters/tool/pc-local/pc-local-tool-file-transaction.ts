import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import {
  realWorkspaceRoot,
  resolveWorkspaceDeletionPath,
  resolveWorkspacePath,
} from './pc-local-tool-paths.js';

export type LocalFileChange = {
  action: 'write' | 'delete';
  filePath: string;
  existed: boolean;
  previousContent: string;
  nextContent: string;
  symbolicLink?: boolean;
};

type FileMutationCoordinator = {
  tail: Promise<void>;
};

type FileIdentity = {
  device: string;
  inode: string;
};

type FileSnapshot = {
  action: LocalFileChange['action'];
  filePath: string;
  existed: boolean;
  previousHash: string;
  actualContentHash: string | null;
  identity: FileIdentity | null;
  parentIdentity: FileIdentity | null;
  symbolicLink: boolean;
  mode: string | null;
  size: string | null;
  modifiedAtNs: string | null;
};

type TransactionEntry = {
  change: LocalFileChange;
  snapshot: FileSnapshot;
  stagePath: string;
  stageIdentity: FileIdentity | null;
  backupPath: string;
  backedUp: boolean;
  installed: boolean;
};

export function createFileMutationCoordinator(): FileMutationCoordinator {
  return { tail: Promise.resolve() };
}

export async function mutationIntegrityToken(
  changes: LocalFileChange[],
  workspaceRoot = '',
): Promise<string> {
  const rootIdentity = workspaceRoot
    ? identityFromStat(await bigintFileStat(realWorkspaceRoot(workspaceRoot)))
    : null;
  return contentHash(JSON.stringify({ rootIdentity, snapshots: await mutationSnapshots(changes) }));
}

/**
 * Best-effort local transaction for a trusted-user desktop application.
 *
 * Paths and contents are revalidated, writes are staged beside their targets,
 * and rename-based backups are restored on failure. This protects against
 * accidental edits and ordinary failures; it is not a security boundary
 * against a hostile same-user process deliberately racing filesystem calls.
 */
export async function commitFileChanges(
  changes: LocalFileChange[],
  state: Record<string, any>,
): Promise<void> {
  await withMutationLock(state, async () => {
    const root = realWorkspaceRoot(state.root);
    for (const change of changes) assertMutationPath(change, root);

    const rootIdentity = identityFromStat(await bigintFileStat(root));
    if (!rootIdentity) throw new Error('Workspace root disappeared before file mutation.');
    const snapshots = await mutationSnapshots(changes);
    assertChangesMatchSnapshots(changes, snapshots);

    const expectedToken = String(state.expectedMutationIntegrityToken || '');
    if (expectedToken && contentHash(JSON.stringify({ rootIdentity, snapshots })) !== expectedToken) {
      throw new Error('Files changed after the approved preview. Review the updated diff and approve again.');
    }

    const entries: TransactionEntry[] = changes.map((change, index) => ({
      change,
      snapshot: snapshots[index]!,
      stagePath: '',
      stageIdentity: null,
      backupPath: '',
      backedUp: false,
      installed: false,
    }));

    let committed = false;
    try {
      for (const entry of entries) {
        if (entry.change.action === 'write') await stageWrite(entry, root);
      }

      // Staging may take time for large patches, so check approved sources once
      // more immediately before the first visible rename.
      const beforeCommit = await mutationSnapshots(changes);
      assertSnapshotsUnchanged(snapshots, beforeCommit);

      for (const entry of entries) {
        if (!entry.change.existed) {
          if (await bigintFileStat(entry.change.filePath)) {
            throw new Error(`File appeared after preview: ${entry.change.filePath}`);
          }
          continue;
        }
        entry.backupPath = transactionSiblingPath(entry.change.filePath, 'backup');
        await rename(entry.change.filePath, entry.backupPath);
        entry.backedUp = true;

        const moved = await mutationSnapshot({
          ...entry.change,
          filePath: entry.backupPath,
        });
        if (!sameApprovedSource(entry.snapshot, moved)) {
          throw new Error(`File changed while it was being backed up: ${entry.change.filePath}`);
        }
      }

      for (const entry of entries) {
        if (entry.change.action !== 'write') continue;
        if (await bigintFileStat(entry.change.filePath)) {
          throw new Error(`Mutation target appeared before install: ${entry.change.filePath}`);
        }
        await rename(entry.stagePath, entry.change.filePath);
        entry.installed = true;
      }
      committed = true;
    } catch (error) {
      const rollbackErrors = await rollbackEntries(entries);
      if (rollbackErrors.length) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `${error instanceof Error ? error.message : String(error)} Rollback was incomplete; recovery copies were retained beside their targets.`,
        );
      }
      throw error;
    } finally {
      if (committed) await cleanupCommittedBackups(entries);
      await cleanupUnusedStages(entries);
    }
  });
}

async function stageWrite(entry: TransactionEntry, root: string): Promise<void> {
  const parent = path.dirname(entry.change.filePath);
  await mkdir(parent, { recursive: true });
  assertMutationPath(entry.change, root);

  entry.stagePath = transactionSiblingPath(entry.change.filePath, 'stage');
  const mode = entry.snapshot.mode === null
    ? 0o666
    : Number(BigInt(entry.snapshot.mode) & 0o777n);
  const handle = await open(entry.stagePath, 'wx', mode);
  try {
    await handle.writeFile(entry.change.nextContent, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (entry.snapshot.mode !== null) await chmod(entry.stagePath, mode);
  entry.stageIdentity = identityFromStat(await bigintFileStat(entry.stagePath));
}

async function rollbackEntries(entries: TransactionEntry[]): Promise<Error[]> {
  const errors: Error[] = [];
  for (const entry of [...entries].reverse()) {
    if (entry.installed) {
      try {
        const currentIdentity = identityFromStat(await bigintFileStat(entry.change.filePath));
        if (currentIdentity && sameIdentity(currentIdentity, entry.stageIdentity)) {
          await rm(entry.change.filePath, { force: true });
        } else if (currentIdentity) {
          throw new Error(`Installed target changed before rollback: ${entry.change.filePath}`);
        }
      } catch (error) {
        errors.push(asError(error));
      }
      entry.installed = false;
    }

    if (entry.backedUp) {
      try {
        if (await bigintFileStat(entry.change.filePath)) {
          throw new Error(`Rollback target is occupied: ${entry.change.filePath}`);
        }
        await rename(entry.backupPath, entry.change.filePath);
        entry.backedUp = false;
      } catch (error) {
        errors.push(asError(error));
      }
    }
  }
  return errors;
}

async function cleanupCommittedBackups(entries: TransactionEntry[]): Promise<void> {
  await Promise.all(entries.map(async (entry) => {
    if (!entry.backedUp || !entry.backupPath) return;
    await rm(entry.backupPath, { force: true }).catch(() => undefined);
    entry.backedUp = false;
  }));
}

async function cleanupUnusedStages(entries: TransactionEntry[]): Promise<void> {
  await Promise.all(entries.map(async (entry) => {
    if (!entry.stagePath || entry.installed) return;
    await rm(entry.stagePath, { force: true }).catch(() => undefined);
  }));
}

function assertMutationPath(change: LocalFileChange, root: string): void {
  const relativePath = path.relative(root, path.resolve(change.filePath));
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`Mutation path escapes the workspace: ${change.filePath}`);
  }
  const validated = change.action === 'delete' && change.symbolicLink
    ? resolveWorkspaceDeletionPath(relativePath, root)
    : resolveWorkspacePath(relativePath, root);
  if (path.resolve(validated) !== path.resolve(change.filePath)) {
    throw new Error(`Mutation path changed after validation: ${change.filePath}`);
  }
}

function assertChangesMatchSnapshots(changes: LocalFileChange[], snapshots: FileSnapshot[]): void {
  changes.forEach((change, index) => {
    const snapshot = snapshots[index]!;
    if (change.existed !== snapshot.existed) {
      throw new Error(`File existence changed after preview: ${change.filePath}`);
    }
    if (snapshot.existed && snapshot.actualContentHash !== snapshot.previousHash) {
      throw new Error(`File content changed after preview: ${change.filePath}`);
    }
    if (Boolean(change.symbolicLink) !== snapshot.symbolicLink) {
      throw new Error(`File type changed after preview: ${change.filePath}`);
    }
  });
}

function assertSnapshotsUnchanged(before: FileSnapshot[], after: FileSnapshot[]): void {
  before.forEach((snapshot, index) => {
    if (!sameApprovedSource(snapshot, after[index]!)) {
      throw new Error(`File changed while the transaction was being staged: ${snapshot.filePath}`);
    }
  });
}

function sameApprovedSource(left: FileSnapshot, right: FileSnapshot): boolean {
  return left.existed === right.existed
    && sameIdentity(left.identity, right.identity)
    && left.actualContentHash === right.actualContentHash
    && left.symbolicLink === right.symbolicLink
    && left.mode === right.mode
    && left.size === right.size
    && left.modifiedAtNs === right.modifiedAtNs;
}

async function mutationSnapshots(changes: LocalFileChange[]): Promise<FileSnapshot[]> {
  return Promise.all(changes.map(mutationSnapshot));
}

async function mutationSnapshot(change: LocalFileChange): Promise<FileSnapshot> {
  const info = await bigintFileStat(change.filePath);
  const actualContent = info
    ? info.isSymbolicLink()
      ? `[symbolic link -> ${await readlink(change.filePath)}]`
      : info.isFile()
        ? await readFile(change.filePath, 'utf8')
        : ''
    : null;
  return {
    action: change.action,
    filePath: path.resolve(change.filePath),
    existed: Boolean(info),
    previousHash: contentHash(change.previousContent),
    actualContentHash: actualContent === null ? null : contentHash(actualContent),
    identity: identityFromStat(info),
    parentIdentity: identityFromStat(await bigintFileStat(path.dirname(change.filePath))),
    symbolicLink: Boolean(info?.isSymbolicLink()),
    mode: info ? String(info.mode) : null,
    size: info ? String(info.size) : null,
    modifiedAtNs: info ? String(info.mtimeNs) : null,
  };
}

async function withMutationLock<T>(
  state: Record<string, any>,
  task: () => Promise<T>,
): Promise<T> {
  const coordinator: FileMutationCoordinator = state.fileMutationCoordinator ??= createFileMutationCoordinator();
  const previous = coordinator.tail;
  let release!: () => void;
  coordinator.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

async function bigintFileStat(filePath: string) {
  return lstat(filePath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

function identityFromStat(
  info: Awaited<ReturnType<typeof bigintFileStat>>,
): FileIdentity | null {
  if (!info) return null;
  return {
    device: String(info.dev),
    inode: String(info.ino),
  };
}

function sameIdentity(left: FileIdentity | null, right: FileIdentity | null): boolean {
  if (!left || !right) return left === right;
  return left.device === right.device && left.inode === right.inode;
}

function transactionSiblingPath(filePath: string, kind: 'stage' | 'backup'): string {
  return path.join(
    path.dirname(filePath),
    `.setsuna-${kind}-${process.pid}-${randomUUID()}`,
  );
}

function contentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
