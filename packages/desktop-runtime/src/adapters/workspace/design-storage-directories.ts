import { lstat, mkdir, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { workspaceTarget } from '@setsuna-desktop/contracts';
import { designDirectoryGrant, designDirectoryGrants, type DesignDirectory, type DesignWorkspace } from '@setsuna-desktop/feature-design/contracts';
import type { FileWorkspaceProjectStore } from './file-workspace-project-store.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';
import { isNodeError } from '../../shared/node-errors.js';
import { createWorkspaceFile } from './workspace-entry-mutations.js';

export function designStorageDirectories(dataDir: string, projects: Pick<FileWorkspaceProjectStore, 'resolveWorkspaceRoot'>) {
  const grants = path.join(dataDir, designDirectoryGrants);
  const localDirectory = async () => ({ id: 'local', path: path.join(await realpath(dataDir), 'designs') });
  async function directory(id: string) {
    if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('Unknown design directory.');
    const saved = await readJsonFile<unknown>(path.join(grants, id + '.json'), null);
    if (typeof saved !== 'string' || !path.isAbsolute(saved)) throw new Error('Unknown design directory.');
    return { id, path: saved };
  }
  return {
    async remember(canonicalPath: string) {
      const grant = await designDirectoryGrant(canonicalPath);
      await writeJsonFile(path.join(grants, grant.id + '.json'), grant.path, { mode: 0o600 });
      return grant;
    },
    async withNewDirectoryGrant(canonicalPath: string, install: () => Promise<void>) {
      const grant = await designDirectoryGrant(canonicalPath);
      const file = path.join(grants, grant.id + '.json');
      await mkdir(grants, { recursive: true });
      const created = await createWorkspaceFile(file, JSON.stringify(grant.path) + '\n', 0o600);
      try {
        // Publishing the content is the last commit step. A grant failure can never remove user files.
        await install();
        return grant;
      } catch (error) {
        const current = await lstat(file).catch(() => undefined);
        if (current?.dev === created.dev && current.ino === created.ino && current.ctimeMs === created.ctimeMs) {
          await unlink(file).catch(() => undefined);
        }
        throw error;
      }
    },
    async resolve(scope: DesignWorkspace) {
      if (scope.storageId === undefined) return projects.resolveWorkspaceRoot(workspaceTarget(scope.projectId, scope.rootId));
      const root = scope.storageId === 'local' ? (await localDirectory()).path : (await directory(scope.storageId)).path;
      if (scope.storageId === 'local') await mkdir(root, { recursive: true });
      // An external directory can be removed or replaced with a symlink between sessions.
      if (path.relative(root, await realpath(root))) throw new Error('The design directory has changed.');
      return root;
    },
    async list(): Promise<DesignDirectory[]> {
      const names = await readdir(grants).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') return [];
        throw error;
      });
      const entries = names.filter((name) => /^[a-f0-9]{64}\.json$/u.test(name));
      // Opening any draft enumerates these grants, so isolate a failed read to its own entry.
      const external = await Promise.all(entries.map(async (name) => {
        try {
          return await directory(name.slice(0, -5));
        } catch (error) {
          const reason = isNodeError(error) ? error.code : 'expected a JSON string containing an absolute path';
          console.warn(`[design-storage] Skipping ${path.join(grants, name)}: ${reason}.`);
          return undefined;
        }
      }));
      return [await localDirectory(), ...external.filter((entry) => entry !== undefined)];
    },
  };
}
