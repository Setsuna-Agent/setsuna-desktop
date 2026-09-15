import type { WorkspaceProjectList } from '@setsuna-desktop/contracts';
import { realpath } from 'node:fs/promises';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { PullRequestRepositories as RepositoryInventory, PullRequestRepository } from '../contracts/index.js';
import { git } from './git.js';

export function githubRepository(remote: string): string | null {
  try {
    const source = remote.replace(/^git@github\.com:/iu, 'ssh://git@github.com/');
    const url = new URL(source);
    if (url.hostname.toLowerCase() !== 'github.com' || !['https:', 'ssh:', 'git:'].includes(url.protocol) || url.password || url.search || url.hash) return null;
    const name = url.pathname.replace(/^\//u, '').replace(/\/$/u, '').replace(/\.git$/iu, '');
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(name) || name.split('/').some((part) => ['.', '..'].includes(part))) return null;
    return name;
  } catch { return null; }
}

export class PullRequestRepositories {
  private roots = new Map<string, string>();
  private cached: { key: string; expiresAt: number; value: RepositoryInventory } | null = null;

  constructor(private readonly projects: { listProjects(): Promise<WorkspaceProjectList> }) {}

  async list(signal?: AbortSignal, force = true): Promise<RepositoryInventory> {
    const projects = (await this.projects.listProjects()).projects;
    const key = JSON.stringify(projects.map(({ id, path, name }) => [id, path, name]));
    if (!force && this.cached?.key === key && this.cached.expiresAt > Date.now()) return this.cached.value;
    const repositories = new Map<string, PullRequestRepository>();
    const roots = new Map<string, string>();
    const issues: RepositoryInventory['issues'] = [];
    for (const project of projects) {
      signal?.throwIfAborted();
      if (!project.path) continue;
      try {
        const projectPath = await realpath(project.path);
        // Non-Git projects are expected in the workspace inventory.
        let cwd: string;
        let names: string;
        try {
          // PR paths are repository-relative, even when a saved project is a subdirectory.
          cwd = await realpath((await git(projectPath, ['rev-parse', '--show-toplevel'], signal)).replace(/\r?\n$/u, ''));
          names = await git(cwd, ['remote'], signal);
        } catch {
          signal?.throwIfAborted();
          if (project.gitRoot) issues.push({ project: project.name, message: 'Could not read Git remotes.' });
          continue;
        }
        for (const remote of names.split('\n').filter(Boolean)) {
          const fullName = githubRepository((await git(cwd, ['remote', 'get-url', '--', remote], signal)).trim());
          if (!fullName) continue;
          const id = fullName.toLowerCase();
          const entry = repositories.get(id) ?? { id, fullName, projects: [], remotes: [] };
          if (!entry.projects.some((item) => item.id === project.id)) entry.projects.push({ id: project.id, name: project.name });
          if (!entry.remotes.includes(remote)) entry.remotes.push(remote);
          repositories.set(id, entry);
          roots.set(id, cwd);
        }
      } catch {
        signal?.throwIfAborted();
        issues.push({ project: project.name, message: 'Could not read this project directory or its Git remotes.' });
      }
    }
    this.roots = roots;
    const value = { repositories: [...repositories.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)), issues };
    this.cached = { key, expiresAt: Date.now() + 30_000, value };
    return value;
  }

  async root(repository: string, signal?: AbortSignal, force = false): Promise<string> {
    // Saved-project changes invalidate immediately; writes also re-read remotes.
    await this.list(signal, force);
    const root = this.roots.get(repository.toLowerCase());
    if (!root) throw new FeatureOperationFailure({ code: 'PR_NOT_FOUND', message: 'This GitHub repository is no longer associated with a saved project.', retryable: false });
    return root;
  }
}
