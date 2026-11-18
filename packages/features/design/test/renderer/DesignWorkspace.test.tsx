// @vitest-environment happy-dom
import { ToastProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DesignWorkspace, { type DesignWorkspaceProps } from '../../src/renderer/DesignWorkspace.js';

vi.mock('../../src/renderer/DesignDocumentSurface.js', () => ({ DesignDocumentSurface: () => null }));

afterEach(cleanup);

it('opens designs from the active root and refreshes them on file changes, return and focus', async () => {
  let resolveFirstRoot: (paths: string[]) => void = () => undefined;
  const firstRoot = new Promise<string[]>((resolve) => { resolveFirstRoot = resolve; });
  let secondaryPaths = ['screens/overview.design.json'];
  let workspaceChanged: (() => void) | undefined;
  const loadDocuments = vi.fn<DesignWorkspaceProps['client']['list']>(({ rootId }) =>
    rootId === 'primary' ? firstRoot : Promise.resolve(secondaryPaths));
  const onLocationChange = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const props: Omit<DesignWorkspaceProps, 'location'> = {
    projects: [{ id: 'project', name: 'Project', createdAt: '', updatedAt: '', roots: [
      { id: 'primary', path: '/project/primary' }, { id: 'secondary', path: '/project/secondary' },
    ] }],
    client: { assets: { search: vi.fn(), read: vi.fn() }, list: loadDocuments, create: vi.fn(), read: vi.fn(), commit: vi.fn(), navigate: vi.fn() },
    onLocationChange,
    watchDirectories: (root, _paths, changed, options) => {
      if (root !== '/project/secondary' || !options?.recursive) return () => undefined;
      workspaceChanged = changed;
      return () => { workspaceChanged = undefined; };
    },
    onAddProject: vi.fn(),
    renderCreateDialog: () => null,
    translate: (key) => key,
  };
  const viewFor = (rootId: string, path?: string) => <ToastProvider>
    <DesignWorkspace {...props} location={{ projectId: 'project', rootId, path }} />
  </ToastProvider>;
  const view = render(viewFor('primary'));
  expect(loadDocuments).toHaveBeenCalledWith({ projectId: 'project', rootId: 'primary' }, expect.any(AbortSignal));
  view.rerender(viewFor('secondary'));
  const overview = await view.findByRole('button', { name: 'screens/overview.design.json' });
  await act(async () => { resolveFirstRoot(['archive/old.design.json']); await firstRoot; });
  expect(view.queryByRole('button', { name: 'archive/old.design.json' })).toBeNull();
  fireEvent.click(overview);
  expect(onLocationChange).toHaveBeenCalledWith({ projectId: 'project', rootId: 'secondary', path: 'screens/overview.design.json' });

  view.rerender(viewFor('secondary', 'screens/overview.design.json'));
  fireEvent.click(view.getByRole('button', { name: 'feature.design.backToDocuments' }));
  expect(onLocationChange).toHaveBeenLastCalledWith({ projectId: 'project', rootId: 'secondary' });
  secondaryPaths = ['screens/renamed.design.json'];
  view.rerender(viewFor('secondary'));
  await view.findByRole('button', { name: 'screens/renamed.design.json' });

  secondaryPaths = [...secondaryPaths, 'screens/inbox/first.design.json'];
  act(() => workspaceChanged?.());
  fireEvent.click(await view.findByRole('button', { name: 'screens/inbox/first.design.json' }));
  expect(onLocationChange).toHaveBeenLastCalledWith({ projectId: 'project', rootId: 'secondary', path: 'screens/inbox/first.design.json' });

  secondaryPaths = ['screens/final.design.json'];
  fireEvent(window, new Event('focus'));
  fireEvent.click(await view.findByRole('button', { name: 'screens/final.design.json' }));
  expect(view.queryByRole('button', { name: 'screens/renamed.design.json' })).toBeNull();
  expect(onLocationChange).toHaveBeenLastCalledWith({ projectId: 'project', rootId: 'secondary', path: 'screens/final.design.json' });
});
