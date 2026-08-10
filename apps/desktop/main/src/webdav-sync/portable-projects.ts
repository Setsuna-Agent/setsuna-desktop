import {
  normalizeWorkspaceProjectName,
  workspaceProjectNameKey,
  type DesktopWebDavSyncCategoryId,
  type DesktopWebDavSyncRestoreProjectAction,
  type WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LocalSnapshotSource } from './model.js';

const PORTABLE_PROJECT_CATALOG_VERSION = 1;
const PORTABLE_PROJECT_CATALOG_PATH = 'portable/projects.json';
const MAX_PROJECT_COUNT = 2_048;
const MAX_PROJECT_CATALOG_BYTES = 2 * 1024 * 1024;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

type StoredProjectIndex = {
  version: 1;
  projects: WorkspaceProject[];
};

export type PortableProjectRecord = {
  id: string;
  name: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type LocalProjectRecord = PortableProjectRecord & {
  path?: string;
  gitRoot?: string;
};

type PortableProjectCatalog = {
  version: 1;
  projects: PortableProjectRecord[];
};

export async function portableProjectCatalogSource(
  dataRoot: string,
  category: Extract<DesktopWebDavSyncCategoryId, 'conversations' | 'memories'>,
): Promise<LocalSnapshotSource> {
  const projects = (await readLocalProjectIndex(dataRoot)).projects.map(toPortableProject);
  const data = Buffer.from(`${JSON.stringify({
    version: PORTABLE_PROJECT_CATALOG_VERSION,
    projects,
  } satisfies PortableProjectCatalog, null, 2)}\n`, 'utf8');
  if (data.byteLength > MAX_PROJECT_CATALOG_BYTES) {
    data.fill(0);
    throw new Error('项目清单超过安全大小限制。');
  }
  return {
    category,
    kind: 'project-catalog',
    logicalPath: PORTABLE_PROJECT_CATALOG_PATH,
    label: '项目关联',
    detail: `${projects.length} 个项目（不含本机目录）`,
    data,
  };
}

export function parsePortableProjectCatalog(data: Buffer): PortableProjectRecord[] {
  if (data.byteLength > MAX_PROJECT_CATALOG_BYTES) throw new Error('项目清单超过安全大小限制。');
  let value: unknown;
  try {
    value = JSON.parse(data.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error('备份中的项目清单不是有效 JSON。', { cause: error });
  }
  if (!isRecord(value) || value.version !== PORTABLE_PROJECT_CATALOG_VERSION || !Array.isArray(value.projects)) {
    throw new Error('备份中的项目清单格式不受支持。');
  }
  if (value.projects.length > MAX_PROJECT_COUNT) throw new Error('备份中的项目数量超过安全限制。');
  return normalizePortableProjects(value.projects);
}

export async function readLocalProjects(dataRoot: string): Promise<LocalProjectRecord[]> {
  return (await readLocalProjectIndex(dataRoot)).projects.map((project) => ({
    ...toPortableProject(project),
    ...(project.path ? { path: project.path } : {}),
    ...(project.gitRoot ? { gitRoot: project.gitRoot } : {}),
  }));
}

export function buildProjectRestoreActions(
  remoteProjects: readonly PortableProjectRecord[],
  localProjects: readonly LocalProjectRecord[],
): DesktopWebDavSyncRestoreProjectAction[] {
  assertUniqueProjectNames(remoteProjects, '备份');
  assertUniqueProjectNames(localProjects, '本机');
  const localByName = new Map(localProjects.map((project) => [
    workspaceProjectNameKey(project.name),
    project,
  ]));
  return remoteProjects.map((project) => {
    const local = localByName.get(workspaceProjectNameKey(project.name));
    return local
      ? {
          sourceProjectId: project.id,
          name: project.name,
          action: 'reuse' as const,
          targetProjectId: local.id,
          directoryBound: Boolean(local.path),
        }
      : {
          sourceProjectId: project.id,
          name: project.name,
          action: 'create' as const,
          directoryBound: false,
        };
  });
}

export async function stageMergedProjectIndex(input: {
  dataRoot: string;
  stagingRoot: string;
  remoteProjects: readonly PortableProjectRecord[];
}): Promise<{
  projectIdMap: Map<string, string>;
  targetPaths: Map<string, string>;
}> {
  const localIndex = await readLocalProjectIndex(input.dataRoot);
  const localProjects = localIndex.projects.map((project) => ({
    ...toPortableProject(project),
    ...(project.path ? { path: project.path } : {}),
    ...(project.gitRoot ? { gitRoot: project.gitRoot } : {}),
  }));
  assertUniqueProjectNames(input.remoteProjects, '备份');
  assertUniqueProjectNames(localProjects, '本机');
  const localByName = new Map(localProjects.map((project) => [
    workspaceProjectNameKey(project.name),
    project,
  ]));
  const usedIds = new Set(localProjects.map((project) => project.id));
  const projectIdMap = new Map<string, string>();
  const targetPaths = new Map<string, string>();
  const restoredProjects: WorkspaceProject[] = [];

  for (const remote of input.remoteProjects) {
    const local = localByName.get(workspaceProjectNameKey(remote.name));
    const targetId = local?.id ?? uniqueProjectId(remote.id, usedIds);
    usedIds.add(targetId);
    projectIdMap.set(remote.id, targetId);
    if (local?.path) targetPaths.set(targetId, local.path);
    restoredProjects.push({
      id: targetId,
      name: remote.name,
      ...(local?.path ? { path: local.path } : {}),
      ...(local?.gitRoot ? { gitRoot: local.gitRoot } : {}),
      // Reusing a project must not change whether the local project is visible.
      // Only newly created records inherit the backup's archive state.
      ...(local
        ? (local.archivedAt ? { archivedAt: local.archivedAt } : {})
        : (remote.archivedAt ? { archivedAt: remote.archivedAt } : {})),
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
    });
  }

  const remoteNameKeys = new Set(input.remoteProjects.map((project) => workspaceProjectNameKey(project.name)));
  const untouchedLocalProjects = localIndex.projects.filter((project) => (
    !remoteNameKeys.has(workspaceProjectNameKey(project.name))
  ));
  const destinationPath = path.join(input.stagingRoot, 'runtime', 'projects.json');
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, `${JSON.stringify({
    version: 1,
    projects: [...restoredProjects, ...untouchedLocalProjects],
  } satisfies StoredProjectIndex, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { projectIdMap, targetPaths };
}

export function projectRestoreFingerprint(
  remoteProjects: readonly PortableProjectRecord[],
  localProjects: readonly LocalProjectRecord[],
): string {
  return JSON.stringify(buildProjectRestoreActions(remoteProjects, localProjects));
}

async function readLocalProjectIndex(dataRoot: string): Promise<StoredProjectIndex> {
  const projectPath = path.join(dataRoot, 'runtime', 'projects.json');
  let value: unknown;
  try {
    const data = await readFile(projectPath);
    if (data.byteLength > MAX_PROJECT_CATALOG_BYTES) throw new Error('本机项目清单超过安全大小限制。');
    value = JSON.parse(data.toString('utf8')) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return { version: 1, projects: [] };
    if (error instanceof SyntaxError) throw new Error('本机项目清单不是有效 JSON。', { cause: error });
    throw error;
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.projects)) {
    throw new Error('本机项目清单格式不受支持。');
  }
  if (value.projects.length > MAX_PROJECT_COUNT) throw new Error('本机项目数量超过安全限制。');
  const projects = value.projects.map(normalizeLocalProject);
  assertUniqueProjectNames(projects, '本机');
  return { version: 1, projects };
}

function normalizePortableProjects(values: unknown[]): PortableProjectRecord[] {
  const projects = values.map((value) => {
    if (!isRecord(value)) throw new Error('备份中的项目条目无效。');
    return {
      id: portableProjectId(value.id),
      name: normalizeWorkspaceProjectName(value.name),
      ...(optionalIsoDate(value.archivedAt) ? { archivedAt: optionalIsoDate(value.archivedAt) } : {}),
      createdAt: requiredIsoDate(value.createdAt, '项目创建时间'),
      updatedAt: requiredIsoDate(value.updatedAt, '项目更新时间'),
    };
  });
  assertUniqueProjectNames(projects, '备份');
  return projects;
}

function normalizeLocalProject(value: unknown): WorkspaceProject {
  if (!isRecord(value)) throw new Error('本机项目条目无效。');
  const localPath = typeof value.path === 'string' && value.path.trim() ? value.path : undefined;
  const gitRoot = typeof value.gitRoot === 'string' && value.gitRoot.trim() ? value.gitRoot : undefined;
  return {
    id: portableProjectId(value.id),
    name: normalizeWorkspaceProjectName(value.name),
    ...(localPath ? { path: localPath } : {}),
    ...(gitRoot ? { gitRoot } : {}),
    ...(optionalIsoDate(value.archivedAt) ? { archivedAt: optionalIsoDate(value.archivedAt) } : {}),
    createdAt: requiredIsoDate(value.createdAt, '项目创建时间'),
    updatedAt: requiredIsoDate(value.updatedAt, '项目更新时间'),
  };
}

function toPortableProject(project: WorkspaceProject): PortableProjectRecord {
  return {
    id: project.id,
    name: project.name,
    ...(project.archivedAt ? { archivedAt: project.archivedAt } : {}),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function uniqueProjectId(sourceId: string, usedIds: Set<string>): string {
  if (!usedIds.has(sourceId)) return sourceId;
  let candidate: string;
  do {
    candidate = `project_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  } while (usedIds.has(candidate));
  return candidate;
}

function assertUniqueProjectNames(
  projects: readonly Pick<PortableProjectRecord, 'name'>[],
  location: string,
): void {
  const names = new Set<string>();
  for (const project of projects) {
    const key = workspaceProjectNameKey(project.name);
    if (names.has(key)) throw new Error(`${location}存在同名项目「${project.name}」，请先重命名后再继续。`);
    names.add(key);
  }
}

function portableProjectId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!PROJECT_ID_PATTERN.test(id)) throw new Error('项目标识无效。');
  return id;
}

function requiredIsoDate(value: unknown, label: string): string {
  const date = optionalIsoDate(value);
  if (!date) throw new Error(`${label}无效。`);
  return date;
}

function optionalIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
