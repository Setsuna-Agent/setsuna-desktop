import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceProjectStore } from '../../src/ports/workspace-project-store.js';
import { WorkspaceSearchCancelledError } from '../../src/ports/workspace-search-engine.js';
import { searchWorkspaceProjectForRest } from '../../src/server/runtime-rest-routes.js';

describe('searchWorkspaceProjectForRest', () => {
  it('owns the project-panel cancellation group and returns completed searches', async () => {
    const completed = { query: 'needle', results: [], truncated: false };
    const workspaceProjects: Pick<WorkspaceProjectStore, 'search'> = {
      search: vi.fn(async () => completed),
    };

    await expect(searchWorkspaceProjectForRest(workspaceProjects, 'project_1', 'needle')).resolves.toBe(completed);
    expect(workspaceProjects.search).toHaveBeenCalledWith('project_1', 'needle', {
      supersedeKey: 'project-content-search',
    });
  });

  it('maps a superseded search to a benign response instead of an HTTP failure', async () => {
    const workspaceProjects: Pick<WorkspaceProjectStore, 'search'> = {
      search: vi.fn(async () => {
        throw new WorkspaceSearchCancelledError('Workspace search was superseded.');
      }),
    };

    await expect(searchWorkspaceProjectForRest(workspaceProjects, 'project_1', 'needle')).resolves.toEqual({
      query: 'needle',
      results: [],
      truncated: false,
      superseded: true,
    });
  });

  it('does not hide unrelated search failures', async () => {
    const workspaceProjects: Pick<WorkspaceProjectStore, 'search'> = {
      search: vi.fn(async () => {
        throw new Error('search failed');
      }),
    };

    await expect(searchWorkspaceProjectForRest(workspaceProjects, 'project_1', 'needle'))
      .rejects.toThrow('search failed');
  });
});
