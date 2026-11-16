import { workspaceTargetRootId, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { expect, it, vi } from 'vitest';
import { searchSidebarWorkspace } from '../../../../src/app/sidebar/searchSidebarWorkspace.js';

it('keeps identical file names in separate roots and preserves available roots after a failure', async () => {
  const project: WorkspaceProject = { id: 'project', name: 'Project', createdAt: '', updatedAt: '',
    roots: [{ id: 'first', path: '/first' }, { id: 'missing', path: '/missing' }, { id: 'second', path: '/second' }] };
  const failure = new Error('Directory unavailable');
  const searchProject = vi.fn(async (target) => {
    if (workspaceTargetRootId(target) === 'missing') throw failure;
    return { query: 'needle', truncated: false, results: [{ path: 'same.ts', line: 12, preview: 'needle' }] };
  });
  const { results, errors } = await searchSidebarWorkspace({ searchProject, searchProjectEntries: vi.fn() }, project, 'needle', 'text', ['ts'], () => true);
  expect(results.map((item) => item.target)).toEqual([
    { projectId: 'project', rootId: 'first', path: 'same.ts', line: 12 },
    { projectId: 'project', rootId: 'second', path: 'same.ts', line: 12 },
  ]);
  expect(new Set(results.map((item) => item.id)).size).toBe(2);
  expect(errors).toEqual([failure]);
});
