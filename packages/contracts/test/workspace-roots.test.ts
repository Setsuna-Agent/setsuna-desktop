import { expect, it } from 'vitest';
import { resolveWorkspaceFileReference, workspaceFileKey, workspaceProjectForRoot, workspaceProjectRoots, type WorkspaceProject } from '../src/index.js';

const project: WorkspaceProject = {
  id: 'project', name: 'Workspace', createdAt: '', updatedAt: '', path: '/repo',
  roots: [{ id: 'main', path: '/repo' }, { id: 'child', path: '/repo/packages/agent' }, { id: 'sibling', path: '/other' }],
};

it('resolves absolute paths to the owning directory and keeps explicitly scoped relative paths in their directory', () => {
  expect(resolveWorkspaceFileReference(project, '/repo/packages/agent/src/a.ts')).toMatchObject({ root: { id: 'child' }, path: 'src/a.ts' });
  expect(resolveWorkspaceFileReference(project, 'packages/agent/src/a.ts', 'main')).toMatchObject({ root: { id: 'main' }, path: 'packages/agent/src/a.ts' });
  expect(resolveWorkspaceFileReference(project, '../other/a.ts')).toMatchObject({ root: { id: 'sibling' }, path: 'a.ts' });
  expect(resolveWorkspaceFileReference(project, '/repo-other/a.ts')).toBeNull();
  expect(resolveWorkspaceFileReference(project, 'a.ts', 'removed')).toBeNull();
  expect(() => workspaceProjectForRoot(project, 'removed')).toThrow();
  expect(workspaceFileKey({ projectId: 'project', rootId: 'main', path: 'same.ts' }))
    .not.toBe(workspaceFileKey({ projectId: 'project', rootId: 'child', path: 'same.ts' }));
});

it('handles Windows drives, UNC paths, and legacy single-directory projects', () => {
  const windows = { ...project, path: 'C:\\repo', roots: [
    { id: 'main', path: 'C:\\repo' }, { id: 'child', path: '\\\\server\\share\\agent' },
  ] };
  expect(resolveWorkspaceFileReference(windows, 'c:\\REPO\\src\\..\\a.ts')).toMatchObject({ root: { id: 'main' }, path: 'a.ts' });
  expect(resolveWorkspaceFileReference(windows, '\\\\SERVER\\share\\agent\\a.ts')).toMatchObject({ root: { id: 'child' }, path: 'a.ts' });
  expect(resolveWorkspaceFileReference(windows, 'C:\\repo\\..\\external\\a.ts')).toBeNull();
  expect(workspaceProjectRoots({ ...project, roots: undefined })).toEqual([{ id: 'primary', path: '/repo' }]);
});
