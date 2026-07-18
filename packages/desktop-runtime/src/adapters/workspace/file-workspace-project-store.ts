import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rm, stat, unlink, writeFile as writeFileFs } from 'node:fs/promises';
import path from 'node:path';
import {
  TEMPORARY_WORKSPACE_PROJECT_ID,
  parseTemporaryWorkspaceProjectId,
  temporaryWorkspaceProjectId,
  type AddWorkspaceProjectInput,
  type WorkspaceEntry,
  type WorkspaceEntrySearchResponse,
  type WorkspaceEntryList,
  type WorkspaceFileRead,
  type WorkspaceFileWrite,
  type WorkspaceProject,
  type WorkspaceProjectList,
  type WorkspaceSearchResponse,
  type WorkspaceSearchResult,
  type WorkspaceStatus,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { TemporaryWorkspaceInput, WorkspaceFileMetadata, WorkspaceImageRead, WorkspaceProjectStore } from '../../ports/workspace-project-store.js';
import { assertSafeRuntimeId } from '../../security/runtime-id.js';
import { detectSafeImageMimeType } from '../../utils/safe-image.js';
import { detectWorkspacePreviewImageMimeType, isProbablyBinaryWorkspaceFile } from '../../utils/workspace-file-preview.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';

const MAX_LIST_ENTRIES = 200;
const MAX_READ_BYTES = 256 * 1024;
export const MAX_WORKSPACE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_SEARCH_RESULTS = 80;
const MAX_ENTRY_SEARCH_SCAN = 12000;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'target', 'release-artifacts']);
const TEMPORARY_WORKSPACE_DATE = /^\d{4}-\d{2}-\d{2}$/u;

type ProjectIndex = {
  version: 1;
  projects: WorkspaceProject[];
};

type FileWorkspaceProjectStoreOptions = {
  temporaryWorkspacePath?: string;
};

export class FileWorkspaceProjectStore implements WorkspaceProjectStore {
  private readonly indexPath: string;
  private readonly temporaryWorkspacePath: string;
  private readonly temporaryWorkspaceDates = new Map<string, string>();

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    options: FileWorkspaceProjectStoreOptions = {},
  ) {
    this.indexPath = path.join(dataDir, 'projects.json');
    this.temporaryWorkspacePath = path.resolve(options.temporaryWorkspacePath ?? path.join(dataDir, 'temporary-workspace'));
  }

  async listProjects(): Promise<WorkspaceProjectList> {
    const index = await this.readIndex();
    return {
      projects: index.projects
        .filter((project) => !project.archivedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  async addProject(input: AddWorkspaceProjectInput): Promise<WorkspaceProject> {
    const projectPath = await normalizeProjectPath(input.path);
    const projectStat = await stat(projectPath);
    if (!projectStat.isDirectory()) throw new Error('Project path must be a directory.');
    return withFileStateUpdate(this.indexPath, async () => {
      const now = this.clock.now().toISOString();
      const index = await this.readIndex();
      const existing = index.projects.find((project) => project.path === projectPath);
      const project: WorkspaceProject = {
        id: existing?.id ?? `project_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        name: input.name?.trim() || existing?.name || path.basename(projectPath) || projectPath,
        path: projectPath,
        gitRoot: await findGitRoot(projectPath),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await this.writeIndex({
        version: 1,
        projects: [project, ...index.projects.filter((item) => item.id !== project.id && item.path !== project.path)],
      });
      return project;
    });
  }

  async archiveProject(projectId: string): Promise<void> {
    await withFileStateUpdate(this.indexPath, async () => {
      const index = await this.readIndex();
      const now = this.clock.now().toISOString();
      await this.writeIndex({
        version: 1,
        projects: index.projects.map((project) => project.id === projectId
          ? { ...project, archivedAt: now, updatedAt: now }
          : project),
      });
    });
  }

  async removeProject(projectId: string): Promise<void> {
    await withFileStateUpdate(this.indexPath, async () => {
      const index = await this.readIndex();
      await this.writeIndex({
        version: 1,
        projects: index.projects.filter((project) => project.id !== projectId),
      });
    });
  }

  async ensureTemporaryWorkspace(input: TemporaryWorkspaceInput): Promise<WorkspaceProject> {
    const threadId = assertSafeRuntimeId(input.threadId, 'Thread id');
    const cachedDate = this.temporaryWorkspaceDates.get(threadId);
    if (cachedDate) return this.threadTemporaryWorkspace(cachedDate, threadId);

    const requestedDate = localDateSegment(input.createdAt, this.clock.now());
    const existingDate = await this.findTemporaryWorkspaceDate(threadId, requestedDate);
    const date = existingDate ?? requestedDate;
    this.temporaryWorkspaceDates.set(threadId, date);
    return this.threadTemporaryWorkspace(date, threadId);
  }

  async removeTemporaryWorkspace(input: TemporaryWorkspaceInput): Promise<void> {
    const threadId = assertSafeRuntimeId(input.threadId, 'Thread id');
    try {
      const rootStat = await lstatIfExists(this.temporaryWorkspacePath);
      if (!rootStat) return;
      // The root is a configured trust boundary. Following a junction here would make an external
      // directory look self-contained after realpath and could turn scoped cleanup into data loss.
      if (rootStat.isSymbolicLink()) {
        throw new Error('Temporary workspace root must not be a symbolic link or junction.');
      }
      if (!rootStat.isDirectory()) throw new Error('Temporary workspace root is not a directory.');
      const temporaryWorkspaceRoot = await realpath(this.temporaryWorkspacePath);
      const requestedDate = localDateSegment(input.createdAt, this.clock.now());
      const cachedDate = this.temporaryWorkspaceDates.get(threadId);
      const date = cachedDate ?? await this.findTemporaryWorkspaceDate(threadId, requestedDate);
      if (!date || !TEMPORARY_WORKSPACE_DATE.test(date)) return;

      const dateDirectory = path.resolve(this.temporaryWorkspacePath, date);
      assertPathWithin(this.temporaryWorkspacePath, dateDirectory);
      const dateStat = await lstatIfExists(dateDirectory);
      if (!dateStat) return;
      if (dateStat.isSymbolicLink()) {
        throw new Error('Temporary workspace date directory must not be a symbolic link or junction.');
      }
      if (!dateStat.isDirectory()) throw new Error('Temporary workspace date path is not a directory.');
      const canonicalDateDirectory = await realpath(dateDirectory);
      const expectedCanonicalDateDirectory = path.resolve(temporaryWorkspaceRoot, date);
      if (!sameResolvedPath(canonicalDateDirectory, expectedCanonicalDateDirectory)) {
        throw new Error('Temporary workspace date directory does not match its canonical path.');
      }

      const target = path.resolve(dateDirectory, threadId);
      assertPathWithin(this.temporaryWorkspacePath, target);
      const targetStat = await lstatIfExists(target);
      if (!targetStat) return;
      // A scoped workspace may have been replaced by a symlink/junction. Remove only that link;
      // recursive deletion must never follow it into a location outside the runtime data root.
      if (targetStat.isSymbolicLink()) {
        await unlink(target);
        return;
      }
      if (!targetStat.isDirectory()) throw new Error('Temporary workspace path is not a directory.');

      const workspacePath = await realpath(target);
      assertPathWithin(canonicalDateDirectory, workspacePath);
      const currentRootStat = await lstat(this.temporaryWorkspacePath);
      if (currentRootStat.isSymbolicLink() || !currentRootStat.isDirectory()) {
        throw new Error('Temporary workspace root changed during cleanup.');
      }
      const currentDateStat = await lstat(dateDirectory);
      if (currentDateStat.isSymbolicLink() || !currentDateStat.isDirectory()) {
        throw new Error('Temporary workspace date directory changed during cleanup.');
      }
      if (!sameResolvedPath(await realpath(dateDirectory), canonicalDateDirectory)) {
        throw new Error('Temporary workspace date directory changed during cleanup.');
      }
      await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } finally {
      this.temporaryWorkspaceDates.delete(threadId);
    }
  }

  async getStatus(projectId?: string): Promise<WorkspaceStatus> {
    const project = await this.findProject(projectId);
    if (!project) return { exists: false, readable: false };
    try {
      const projectStat = await stat(project.path);
      const fileCount = projectStat.isDirectory() ? await countEntries(project.path) : 0;
      return {
        project,
        exists: true,
        readable: projectStat.isDirectory(),
        fileCount,
        gitRoot: await findGitRoot(project.path),
      };
    } catch {
      return { project, exists: false, readable: false };
    }
  }

  async listEntries(projectId: string, relativePath = '.'): Promise<WorkspaceEntryList> {
    const project = await this.requireProject(projectId);
    const target = await safeResolve(project.path, relativePath);
    const targetStat = await stat(target);
    if (!targetStat.isDirectory()) throw new Error('Path is not a directory.');
    const entries = await readdir(target, { withFileTypes: true });
    const visible = entries
      .filter((entry) => !IGNORED_DIRS.has(entry.name) && !entry.isSymbolicLink())
      .slice(0, MAX_LIST_ENTRIES);
    const mapped = await Promise.all(
      visible.map(async (entry): Promise<WorkspaceEntry> => {
        const absolutePath = path.join(target, entry.name);
        const entryStat = await stat(absolutePath);
        const relative = toProjectRelative(project.path, absolutePath);
        return {
          name: entry.name,
          path: relative,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isFile() ? entryStat.size : undefined,
          modifiedAt: entryStat.mtime.toISOString(),
        };
      }),
    );
    return {
      basePath: normalizeRelativePath(relativePath),
      entries: mapped.sort((a, b) => `${a.type === 'file' ? 1 : 0}:${a.name}`.localeCompare(`${b.type === 'file' ? 1 : 0}:${b.name}`)),
    };
  }

  async searchEntries(projectId: string, query = '', parent?: string | null): Promise<WorkspaceEntrySearchResponse> {
    const project = await this.requireProject(projectId);
    const search = normalizeEntrySearchText(query);
    const parentScoped = parent !== undefined && parent !== null;
    const startDirectory = parentScoped ? await safeResolve(project.path, parent || '.') : project.path;
    const startStat = await stat(startDirectory);
    if (!startStat.isDirectory()) throw new Error('Path is not a directory.');

    const entries: WorkspaceEntrySearchResponse['entries'] = [];
    const stack = [startDirectory];
    const maxResults = parentScoped && !search ? Number.POSITIVE_INFINITY : MAX_ENTRY_SEARCH_RESULTS;
    let stackIndex = 0;
    let scanned = 0;
    let truncated = false;

    traversal: while (stackIndex < stack.length) {
      const current = stack[stackIndex];
      stackIndex += 1;
      const directoryEntries = await sortedDirectoryEntries(current);

      for (const entry of directoryEntries) {
        if (IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
        if (scanned >= MAX_ENTRY_SEARCH_SCAN) {
          truncated = true;
          break traversal;
        }

        const absolutePath = path.join(current, entry.name);
        const relativePath = toProjectRelative(project.path, absolutePath).replace(/\\/g, '/');
        scanned += 1;

        if (entry.isDirectory()) {
          if (!parentScoped) stack.push(absolutePath);
        } else if (!entry.isFile()) {
          continue;
        }

        const haystack = `${relativePath} ${entry.name}`.toLowerCase();
        if (search && !haystack.includes(search)) continue;
        if (entries.length >= maxResults) {
          truncated = true;
          break traversal;
        }

        entries.push({
          kind: entry.isDirectory() ? 'directory' : 'file',
          name: entry.name,
          parent: parentForRelativePath(relativePath),
          path: relativePath,
        });
      }
    }

    return {
      entries,
      query: search,
      scanned,
      truncated,
      workspaceRoot: project.path,
    };
  }

  async inspectFile(projectId: string, relativePath: string): Promise<WorkspaceFileMetadata> {
    const project = await this.requireProject(projectId);
    const target = await safeResolve(project.path, relativePath);
    const targetStat = await stat(target);
    if (!targetStat.isFile()) throw new Error('Path is not a file.');
    return {
      projectId,
      path: toProjectRelative(project.path, target),
      size: targetStat.size,
      modifiedAt: targetStat.mtime.toISOString(),
    };
  }

  async readFile(projectId: string, relativePath: string): Promise<WorkspaceFileRead> {
    const project = await this.requireProject(projectId);
    const target = await safeResolve(project.path, relativePath);
    const targetStat = await stat(target);
    if (!targetStat.isFile()) throw new Error('Path is not a file.');
    const buffer = await readFile(target);
    const path = toProjectRelative(project.path, target);
    const modifiedAt = targetStat.mtime.toISOString();
    const imageMimeType = detectWorkspacePreviewImageMimeType(buffer);
    if (imageMimeType) {
      if (buffer.byteLength > MAX_WORKSPACE_IMAGE_BYTES) {
        return {
          projectId,
          path,
          content: '',
          size: buffer.byteLength,
          modifiedAt,
          preview: { kind: 'unsupported', reason: 'image-too-large' },
          truncated: false,
        };
      }
      return {
        projectId,
        path,
        content: '',
        size: buffer.byteLength,
        modifiedAt,
        preview: { kind: 'image', base64: buffer.toString('base64'), mimeType: imageMimeType },
        truncated: false,
      };
    }
    if (isProbablyBinaryWorkspaceFile(buffer)) {
      return {
        projectId,
        path,
        content: '',
        size: buffer.byteLength,
        modifiedAt,
        preview: { kind: 'unsupported', reason: 'binary' },
        truncated: false,
      };
    }
    const truncated = buffer.byteLength > MAX_READ_BYTES;
    return {
      projectId,
      path,
      content: buffer.subarray(0, MAX_READ_BYTES).toString('utf8'),
      size: buffer.byteLength,
      modifiedAt,
      preview: { kind: 'text' },
      truncated,
    };
  }

  async readImage(projectId: string, relativePath: string): Promise<WorkspaceImageRead> {
    const project = await this.requireProject(projectId);
    const target = await safeResolve(project.path, relativePath);
    const targetStat = await stat(target);
    if (!targetStat.isFile()) throw new Error('Path is not a file.');
    if (!targetStat.size) throw new Error('Image file is empty.');
    if (targetStat.size > MAX_WORKSPACE_IMAGE_BYTES) {
      throw new Error(`Image exceeds the ${MAX_WORKSPACE_IMAGE_BYTES} byte workspace limit.`);
    }
    const buffer = await readFile(target);
    const mimeType = detectSafeImageMimeType(buffer);
    if (!mimeType) throw new Error('Unsupported image format. Use PNG, JPEG, GIF, or WebP.');
    return {
      projectId,
      path: toProjectRelative(project.path, target),
      mimeType,
      size: buffer.byteLength,
      modifiedAt: targetStat.mtime.toISOString(),
      base64: buffer.toString('base64'),
    };
  }

  async writeFile(projectId: string, relativePath: string, content: string): Promise<WorkspaceFileWrite> {
    return this.writeWorkspaceFile(projectId, relativePath, content);
  }

  async writeBinaryFile(projectId: string, relativePath: string, content: Uint8Array): Promise<WorkspaceFileWrite> {
    return this.writeWorkspaceFile(projectId, relativePath, content);
  }

  async deleteFile(projectId: string, relativePath: string): Promise<void> {
    const project = await this.requireProject(projectId);
    const target = await safeResolve(project.path, relativePath);
    const targetStat = await stat(target);
    if (!targetStat.isFile()) throw new Error('Path is not a file.');
    await rm(target, { force: true });
  }

  private async writeWorkspaceFile(
    projectId: string,
    relativePath: string,
    content: string | Uint8Array,
  ): Promise<WorkspaceFileWrite> {
    const project = await this.requireProject(projectId);
    const target = await safeResolveForWrite(project.path, relativePath);
    const existed = await stat(target).then((value) => value.isFile()).catch(() => false);
    await mkdir(path.dirname(target), { recursive: true });
    if (typeof content === 'string') await writeFileFs(target, content, 'utf8');
    else await writeFileFs(target, content);
    const targetStat = await stat(target);
    return {
      projectId,
      path: toProjectRelative(project.path, target),
      size: targetStat.size,
      modifiedAt: targetStat.mtime.toISOString(),
      created: !existed,
    };
  }

  async search(projectId: string, query: string): Promise<WorkspaceSearchResponse> {
    const project = await this.requireProject(projectId);
    const needle = query.trim();
    if (!needle) return { query, results: [], truncated: false };
    const results: WorkspaceSearchResult[] = [];
    let truncated = false;
    await walkWorkspaceFiles(project.path, async (filePath) => {
      if (results.length >= MAX_SEARCH_RESULTS) {
        truncated = true;
        return false;
      }
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size > MAX_SEARCH_FILE_BYTES) return true;
      const text = await readFile(filePath, 'utf8').catch(() => '');
      if (!text) return true;
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].toLowerCase().includes(needle.toLowerCase())) {
          results.push({
            path: toProjectRelative(project.path, filePath),
            line: index + 1,
            preview: lines[index].trim().slice(0, 240),
          });
          if (results.length >= MAX_SEARCH_RESULTS) {
            truncated = true;
            return false;
          }
        }
      }
      return true;
    });
    return { query, results, truncated };
  }

  private async findProject(projectId?: string): Promise<WorkspaceProject | undefined> {
    if (!projectId || projectId === TEMPORARY_WORKSPACE_PROJECT_ID) return this.legacyTemporaryWorkspace();
    const temporaryReference = parseTemporaryWorkspaceProjectId(projectId);
    if (temporaryReference) {
      const threadId = assertSafeRuntimeId(temporaryReference.threadId, 'Thread id');
      const workspaceDirectory = path.join(this.temporaryWorkspacePath, temporaryReference.date, threadId);
      // Scoped ids are references, not authority to create a conversation workspace.
      // Only ensureTemporaryWorkspace may materialize one and bind its creation date.
      if (!(await directoryExists(workspaceDirectory))) return undefined;
      return this.threadTemporaryWorkspace(temporaryReference.date, threadId);
    }
    const index = await this.readIndex();
    return index.projects.find((project) => project.id === projectId);
  }

  private async legacyTemporaryWorkspace(): Promise<WorkspaceProject> {
    return this.temporaryWorkspaceProject(TEMPORARY_WORKSPACE_PROJECT_ID, this.temporaryWorkspacePath);
  }

  private async threadTemporaryWorkspace(date: string, threadId: string): Promise<WorkspaceProject> {
    if (!TEMPORARY_WORKSPACE_DATE.test(date)) throw new Error('Temporary workspace date is invalid.');
    const projectId = temporaryWorkspaceProjectId({ date, threadId });
    return this.temporaryWorkspaceProject(projectId, path.join(this.temporaryWorkspacePath, date, threadId));
  }

  private async temporaryWorkspaceProject(projectId: string, workspaceDirectory: string): Promise<WorkspaceProject> {
    await mkdir(workspaceDirectory, { recursive: true });
    const temporaryWorkspaceRoot = await realpath(this.temporaryWorkspacePath);
    const workspacePath = await realpath(workspaceDirectory);
    assertPathWithin(temporaryWorkspaceRoot, workspacePath);
    const workspaceStat = await stat(workspacePath);
    return {
      id: projectId,
      name: '临时目录',
      path: workspacePath,
      gitRoot: await findGitRoot(workspacePath),
      createdAt: workspaceStat.birthtime.toISOString(),
      updatedAt: workspaceStat.mtime.toISOString(),
    };
  }

  private async findTemporaryWorkspaceDate(threadId: string, requestedDate: string): Promise<string | null> {
    await mkdir(this.temporaryWorkspacePath, { recursive: true });
    if (await directoryExists(path.join(this.temporaryWorkspacePath, requestedDate, threadId))) return requestedDate;
    const entries = await readdir(this.temporaryWorkspacePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !TEMPORARY_WORKSPACE_DATE.test(entry.name) || entry.name === requestedDate) continue;
      if (await directoryExists(path.join(this.temporaryWorkspacePath, entry.name, threadId))) return entry.name;
    }
    return null;
  }

  private async requireProject(projectId: string): Promise<WorkspaceProject> {
    const project = await this.findProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return project;
  }

  private async readIndex(): Promise<ProjectIndex> {
    return readJsonFile<ProjectIndex>(this.indexPath, { version: 1, projects: [] });
  }

  private async writeIndex(index: ProjectIndex): Promise<void> {
    await writeJsonFile(this.indexPath, index);
  }
}

async function normalizeProjectPath(inputPath: string): Promise<string> {
  const trimmed = inputPath.trim();
  if (!trimmed) throw new Error('Project path is required.');
  const expanded = trimmed.startsWith('~/') ? path.join(process.env.HOME ?? '', trimmed.slice(2)) : trimmed;
  return realpath(path.resolve(expanded));
}

function localDateSegment(createdAt: string | undefined, fallback: Date): string {
  const parsed = createdAt ? new Date(createdAt) : fallback;
  const date = Number.isNaN(parsed.getTime()) ? fallback : parsed;
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function directoryExists(directory: string): Promise<boolean> {
  return stat(directory).then((value) => value.isDirectory()).catch(() => false);
}

async function lstatIfExists(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertPathWithin(root: string, target: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Temporary workspace escapes its storage root.');
  }
}

function sameResolvedPath(left: string, right: string): boolean {
  return path.relative(path.resolve(left), path.resolve(right)) === '';
}

async function safeResolve(projectRoot: string, relativePath: string): Promise<string> {
  const target = await realpath(path.resolve(projectRoot, normalizeRelativePath(relativePath)));
  const relative = path.relative(projectRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes the project workspace.');
  }
  return target;
}

async function safeResolveForWrite(projectRoot: string, relativePath: string): Promise<string> {
  const normalized = normalizeRelativePath(relativePath);
  const target = path.resolve(projectRoot, normalized);
  const parent = await realExistingParent(path.dirname(target));
  const relativeParent = path.relative(projectRoot, parent);
  if (relativeParent.startsWith('..') || path.isAbsolute(relativeParent)) {
    throw new Error('Path escapes the project workspace.');
  }
  const relativeTarget = path.relative(projectRoot, target);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    throw new Error('Path escapes the project workspace.');
  }
  return target;
}

async function realExistingParent(startPath: string): Promise<string> {
  let current = startPath;
  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new Error('No writable parent directory exists.');
      current = parent;
    }
  }
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.trim() || '.';
  return normalized.replace(/^\/+/, '') || '.';
}

function toProjectRelative(projectRoot: string, absolutePath: string): string {
  return (path.relative(projectRoot, absolutePath) || '.').replace(/\\/g, '/');
}

async function sortedDirectoryEntries(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries.sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name));
}

function normalizeEntrySearchText(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
}

function parentForRelativePath(relativePath: string): string {
  const index = relativePath.lastIndexOf('/');
  return index >= 0 ? relativePath.slice(0, index) : '';
}

async function findGitRoot(startPath: string): Promise<string | undefined> {
  let current = startPath;
  for (;;) {
    try {
      const gitStat = await stat(path.join(current, '.git'));
      if (gitStat.isDirectory() || gitStat.isFile()) return current;
    } catch {
      // 持续向上查找，直到文件系统根目录。
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function countEntries(root: string): Promise<number> {
  let count = 0;
  await walkWorkspaceFiles(root, async () => {
    count += 1;
    return count < 10000;
  });
  return count;
}

export async function walkWorkspaceFiles(root: string, onFile: (filePath: string) => Promise<boolean>): Promise<boolean> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!(await walkWorkspaceFiles(absolutePath, onFile))) return false;
    } else if (!(await onFile(absolutePath))) {
      return false;
    }
  }
  return true;
}
