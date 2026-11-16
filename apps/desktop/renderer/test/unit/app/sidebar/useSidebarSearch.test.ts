// @vitest-environment happy-dom
import type { DesktopRuntimeClient, WorkspaceProject, WorkspaceSearchResponse } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSidebarSearch } from '../../../../src/app/sidebar/useSidebarSearch.js';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const projects: WorkspaceProject[] = ['A', 'B'].map((id) => ({ id, name: id, path: `/${id}`, createdAt: '', updatedAt: '' }));

it('isolates results by project and suffix even when earlier searches finish last', async () => {
  vi.useFakeTimers();
  const first = deferred<WorkspaceSearchResponse>();
  const second = deferred<WorkspaceSearchResponse>();
  const third = deferred<WorkspaceSearchResponse>();
  const searchProject = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  const client = { searchProject } as unknown as DesktopRuntimeClient;
  const view = renderHook(({ project, extensions }) => useSidebarSearch({
    client, project, extensions, query: 'needle', category: 'text', projects, threads: [],
  }), { initialProps: { project: projects[0], extensions: '*.ts' }, wrapper: ToastProvider });
  expect(searchProject).toHaveBeenCalledTimes(1);
  view.rerender({ project: projects[1], extensions: '*.ts' });
  expect(searchProject).toHaveBeenCalledTimes(2);
  view.rerender({ project: projects[1], extensions: '*.tsx' });
  expect(view.result.current.text).toEqual([]);
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(searchProject).toHaveBeenLastCalledWith({ projectId: 'B', rootId: 'primary' }, 'needle', { fileExtensions: ['tsx'] });
  await act(async () => { third.resolve(response('new.tsx', 9)); await third.promise; });
  expect(view.result.current.text.map((item) => item.target)).toEqual([{ projectId: 'B', rootId: 'primary', path: 'new.tsx', line: 9 }]);
  await act(async () => {
    second.resolve(response('old.ts', 3)); first.resolve(response('wrong-project.ts', 1));
    await Promise.all([second.promise, first.promise]);
  });
  expect(view.result.current.text.map((item) => item.target.path)).toEqual(['new.tsx']);
  expect(view.result.current.loading).toBe(false);
});

function response(path: string, line: number): WorkspaceSearchResponse {
  return { query: 'needle', results: [{ path, line, preview: 'needle' }], truncated: false };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
