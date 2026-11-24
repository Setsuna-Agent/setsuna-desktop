// @vitest-environment happy-dom
import { ToastProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, renderHook, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import DesignWorkspace, { type DesignWorkspaceLocation, type DesignWorkspaceProps } from '../../src/renderer/DesignWorkspace.js';
import { designDocumentVersion, type DesignSnapshot, type ProjectDesignEntry } from '../../src/contracts/index.js';
import { useDesignDocument } from '../../src/renderer/use-design-document.js';

vi.mock('../../src/renderer/DesignDocumentSurface.js', () => ({ DesignDocumentSurface: () => null }));

afterEach(cleanup);

const projects: DesignWorkspaceProps['projects'] = [{ id: 'project', name: 'Project', createdAt: '', updatedAt: '', roots: [
  { id: 'primary', path: '/project/primary' }, { id: 'secondary', path: '/project/secondary' },
] }, { id: 'other', name: 'Other', createdAt: '', updatedAt: '', path: '/other' }];

function testClient(operations: Partial<DesignWorkspaceProps['client']>): DesignWorkspaceProps['client'] {
  const list = operations.list ?? vi.fn().mockResolvedValue([]);
  return {
    projectDesigns: async () => [], catalog: async () => ({ directories: [], associations: [] }), setProject: vi.fn(),
    fonts: { list: vi.fn().mockResolvedValue([]), import: vi.fn(), read: vi.fn(), remove: vi.fn() },
    assets: { search: vi.fn(), read: vi.fn(), readLinkedImage: vi.fn(), requestClipboardPaste: vi.fn(), output: {
      saveDesignHtml: vi.fn(), saveDesignSvg: vi.fn(), saveImageAs: vi.fn(), copyImageToClipboard: vi.fn(),
      copyDesignLayers: vi.fn(), readDesignLayers: vi.fn(), copyText: vi.fn(),
    } },
    list, listEntries: async (...args) => (await list(...args)).map((path) => ({ path })),
    create: vi.fn(), move: vi.fn(), delete: vi.fn(), importImage: vi.fn(), read: vi.fn(), commit: vi.fn(), navigate: vi.fn(),
    importScript: vi.fn(), readScriptParameters: vi.fn(), renderScript: vi.fn(), importShader: vi.fn(), readShader: vi.fn(),
    resolveResourceRoot: async (ref) => ref,
    prepareLibraryPreset: vi.fn(),
    ...operations,
  };
}

it('restores the locally selected catalog view after reopening the workspace', async () => {
  const catalogViewKey = 'setsuna.design.catalog-view';
  const componentViewKey = 'setsuna.design.component-view';
  const view = <ToastProvider><DesignWorkspace projects={[]} client={testClient({})} location={null}
    onLocationChange={vi.fn()} watchDirectories={() => () => undefined} translate={(key) => key} /></ToastProvider>;
  try {
    window.localStorage.setItem(componentViewKey, 'list');
    const first = render(view);
    fireEvent.click(await first.findByRole('button', { name: 'feature.design.catalog.list', pressed: false }));
    expect(window.localStorage.getItem(catalogViewKey)).toBe('list');
    first.unmount();

    const reopened = render(view);
    await reopened.findByRole('button', { name: 'feature.design.catalog.list', pressed: true });
    fireEvent.click(reopened.getByRole('button', { name: 'feature.design.catalog.grid', pressed: false }));
    expect(window.localStorage.getItem(catalogViewKey)).toBe('grid');
    expect(window.localStorage.getItem(componentViewKey)).toBe('list');
  } finally {
    window.localStorage.removeItem(catalogViewKey);
    window.localStorage.removeItem(componentViewKey);
  }
});

it('combines projects selected in one menu and keeps the filter after opening a draft', async () => {
  const available = [...projects, { id: 'third', name: 'Third', path: '/third', createdAt: '', updatedAt: '' }];
  const client = testClient({
    catalog: async () => ({ directories: [{ id: 'local', path: '/designs' }],
      associations: [{ file: '/designs/linked.design.json', projectId: 'other' }] }),
    list: async ({ projectId, rootId, storageId }) => {
      if (storageId === 'local') return ['standalone.design.json', 'linked.design.json'];
      if (projectId === 'project' && rootId === 'primary') return ['first.design.json'];
      if (projectId === 'other') return ['other.design.json'];
      return projectId === 'third' ? ['third.design.json'] : [];
    },
  });
  const navigate = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const watchDirectories = () => () => undefined;
  const translate = (key: string) => key;
  function Workspace() {
    const [location, setLocation] = useState<DesignWorkspaceLocation | null>(null);
    return <DesignWorkspace client={client} projects={available} location={location} translate={translate} watchDirectories={watchDirectories}
      onLocationChange={(next) => { navigate(next); setLocation(next); }} />;
  }

  const view = render(<ToastProvider><Workspace /></ToastProvider>);
  const unlinked = { name: 'feature.design.localDesigns / standalone.design.json' };
  const third = { name: 'Third / third.design.json' };
  await view.findByRole('button', unlinked);
  await view.findByRole('button', third);
  const openProjects = () => fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.project' }), { key: 'Enter' });
  openProjects();
  fireEvent.click(await view.findByRole('menuitemcheckbox', { name: 'Project', checked: false }));
  fireEvent.click(view.getByRole('menuitemcheckbox', { name: 'Other', checked: false }));
  expect(view.getByRole('menuitemcheckbox', { name: 'Project', checked: true })).toBeDefined();
  expect(view.getByRole('menuitemcheckbox', { name: 'Other', checked: true })).toBeDefined();
  fireEvent.keyDown(view.getByRole('menu'), { key: 'Escape' });

  const filter = { projectIds: ['project', 'other'] };
  expect(navigate).toHaveBeenLastCalledWith(filter);
  const first = await view.findByRole('button', { name: 'Project / primary / first.design.json' });
  await view.findByRole('button', { name: 'Other / other.design.json' });
  await view.findByRole('button', { name: 'feature.design.localDesigns / linked.design.json' });
  expect(view.queryByRole('button', unlinked)).toBeNull();
  expect(view.queryByRole('button', third)).toBeNull();

  fireEvent.click(first);
  await waitFor(() => expect(navigate).toHaveBeenLastCalledWith({ projectId: 'project', rootId: 'primary', path: 'first.design.json', homeFilter: filter }));
  fireEvent.click(await view.findByRole('button', { name: 'feature.design.backToDocuments' }));
  expect(navigate).toHaveBeenLastCalledWith(filter);
  await view.findByRole('button', { name: 'Other / other.design.json' });
  openProjects();
  fireEvent.click(await view.findByRole('menuitem', { name: 'feature.design.allProjects' }));
  expect(navigate).toHaveBeenLastCalledWith(null);
  await view.findByRole('button', unlinked);
  await view.findByRole('button', third);
});

it('lists drafts across projects without waiting for a slow root and preserves the chosen list filter', async () => {
  let resolveFirstRoot: (paths: string[]) => void = () => undefined;
  const firstRoot = new Promise<string[]>((resolve) => { resolveFirstRoot = resolve; });
  let secondaryPaths = ['screens/overview.design.json'];
  let workspaceChanged: (() => void) | undefined;
  const loadDocuments = vi.fn<DesignWorkspaceProps['client']['list']>(({ projectId, rootId }) => {
    if (projectId === 'other') return Promise.resolve(['screens/overview.design.json']);
    return rootId === 'primary' ? firstRoot : Promise.resolve(secondaryPaths);
  });
  const onLocationChange = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const props: Omit<DesignWorkspaceProps, 'location'> = {
    projects,
    client: testClient({ list: loadDocuments }),
    onLocationChange,
    watchDirectories: (root, _paths, changed, options) => {
      if (root !== '/project/secondary' || !options?.recursive) return () => undefined;
      workspaceChanged = changed;
      return () => { workspaceChanged = undefined; };
    },
    translate: (key) => key,
  };
  const viewFor = (location: DesignWorkspaceLocation | null) => <ToastProvider>
    <DesignWorkspace {...props} location={location} />
  </ToastProvider>;
  const view = render(viewFor(null));
  expect(loadDocuments).toHaveBeenCalledWith({ projectId: 'project', rootId: 'primary' }, expect.any(AbortSignal));
  await view.findByRole('button', { name: 'Project / secondary / screens/overview.design.json' });
  fireEvent.click(await view.findByRole('button', { name: 'Other / screens/overview.design.json' }));
  await waitFor(() => expect(onLocationChange).toHaveBeenLastCalledWith({ projectId: 'other', rootId: 'primary', path: 'screens/overview.design.json' }));

  const filter = { projectId: 'project', rootId: 'secondary' };
  view.rerender(viewFor(filter));
  const overview = await view.findByRole('button', { name: 'Project / secondary / screens/overview.design.json' });
  await act(async () => { resolveFirstRoot(['archive/old.design.json']); await firstRoot; });
  expect(view.queryByRole('button', { name: 'Project / primary / archive/old.design.json' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Other / screens/overview.design.json' })).toBeNull();
  fireEvent.click(overview);
  const open = { ...filter, path: 'screens/overview.design.json', homeFilter: filter };
  await waitFor(() => expect(onLocationChange).toHaveBeenLastCalledWith(open));

  view.rerender(viewFor(open));
  fireEvent.click(view.getByRole('button', { name: 'feature.design.backToDocuments' }));
  expect(onLocationChange).toHaveBeenLastCalledWith(filter);
  secondaryPaths = ['screens/renamed.design.json'];
  view.rerender(viewFor(filter));
  await view.findByRole('button', { name: 'Project / secondary / screens/renamed.design.json' });

  secondaryPaths = [...secondaryPaths, 'screens/inbox/first.design.json'];
  act(() => workspaceChanged?.());
  fireEvent.click(await view.findByRole('button', { name: 'Project / secondary / screens/inbox/first.design.json' }));
  await waitFor(() => expect(onLocationChange).toHaveBeenLastCalledWith({ ...open, path: 'screens/inbox/first.design.json' }));

  secondaryPaths = ['screens/final.design.json'];
  fireEvent(window, new Event('focus'));
  fireEvent.click(await view.findByRole('button', { name: 'Project / secondary / screens/final.design.json' }));
  expect(view.queryByRole('button', { name: 'Project / secondary / screens/renamed.design.json' })).toBeNull();
  await waitFor(() => expect(onLocationChange).toHaveBeenLastCalledWith({ ...open, path: 'screens/final.design.json' }));
});

it('only declares a filtered catalog empty once possible draft locations have loaded', async () => {
  const linked = Promise.withResolvers<string[]>();
  const unrelated = Promise.withResolvers<string[]>();
  const local = { id: 'local', path: '/designs' };
  const archive = { id: 'archive', path: '/designs-archive' };
  const list = vi.fn<DesignWorkspaceProps['client']['list']>(({ storageId }) => {
    if (storageId === local.id) return linked.promise;
    if (storageId === archive.id) return unrelated.promise;
    return Promise.resolve([]);
  });
  const client = testClient({ list, catalog: async () => ({
    directories: [local, archive], associations: [{ file: '/designs/linked.design.json', projectId: 'other' }],
  }) });
  const view = render(<ToastProvider><DesignWorkspace client={client} projects={[projects[1]]} location={{ projectId: 'other' }}
    onLocationChange={vi.fn()} watchDirectories={() => () => undefined} translate={(key) => key} /></ToastProvider>);
  const empty = { name: 'feature.design.noProjectDrafts' };
  try {
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith({ storageId: local.id }, expect.any(AbortSignal));
      expect(list).toHaveBeenCalledWith({ storageId: archive.id }, expect.any(AbortSignal));
    });
    expect(view.queryByRole('heading', empty)).toBeNull();
    await act(async () => { linked.resolve([]); await linked.promise; });
    await view.findByRole('heading', empty);
  } finally {
    await act(async () => { linked.resolve([]); unrelated.resolve([]); });
  }
});

it('switches projects inside the canvas, including an empty project and a late project lookup', async () => {
  const source = { projectId: 'project', rootId: 'secondary', path: 'source.design.json' };
  const first = { storageId: 'local', path: 'a-linked.design.json' };
  const second = { projectId: 'other', rootId: 'primary', path: 'b-project.design.json' };
  const drafts: ProjectDesignEntry[] = [{ ref: first, documentId: 'first' }, { ref: second, documentId: 'second' }];
  const delayed = Promise.withResolvers<ProjectDesignEntry[]>();
  const projectDesigns = vi.fn<DesignWorkspaceProps['client']['projectDesigns']>()
    .mockImplementationOnce(() => delayed.promise)
    .mockImplementation(async (projectId) => projectId === 'other' ? drafts : []);
  const client = testClient({
    catalog: async () => ({ directories: [{ id: 'local', path: '/designs' }], associations: [{ file: '/designs/a-linked.design.json', projectId: 'other' }] }),
    projectDesigns,
    read: async () => ({ document: { schemaVersion: designDocumentVersion, documentId: 'source', rootIds: [], nodes: {} },
      revision: 'initial', canUndo: false, canRedo: false }),
  });
  const available = [...projects, { id: 'empty', name: 'Empty', path: '/empty', createdAt: '', updatedAt: '' }];
  const props = { client, projects: available, translate: (key: string) => key, watchDirectories: () => () => undefined };
  const navigate = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  function Workspace() {
    const [location, setLocation] = useState<DesignWorkspaceLocation | null>(source);
    return <DesignWorkspace {...props} location={location} onLocationChange={(next) => { navigate(next); setLocation(next); }} />;
  }

  const view = render(<ToastProvider><Workspace /></ToastProvider>);
  async function chooseProject(name: string) {
    fireEvent.keyDown(await view.findByRole('button', { name: 'feature.design.project' }), { key: 'Enter' });
    fireEvent.click(await view.findByRole('menuitem', { name }));
  }

  await chooseProject('Other');
  expect(projectDesigns).toHaveBeenCalledWith('other', expect.any(AbortSignal));
  await chooseProject('Empty');
  await view.findByRole('region', { name: 'feature.design.canvas' });
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ projectId: 'empty', projectCanvas: true });
  await act(async () => { delayed.resolve(drafts); await delayed.promise; });
  expect(navigate).toHaveBeenCalledTimes(1);

  await chooseProject('Other');
  const homeFilter = { projectId: 'other' };
  await waitFor(() => expect(navigate).toHaveBeenNthCalledWith(2, { ...first, homeFilter, projectCanvas: true }));
  fireEvent.keyDown(await view.findByRole('button', { name: 'feature.design.documents' }), { key: 'Enter' });
  fireEvent.click(await view.findByRole('menuitem', { name: 'b-project' }));
  await waitFor(() => expect(navigate).toHaveBeenNthCalledWith(3, { ...second, homeFilter, projectCanvas: true }));
  expect(client.setProject).not.toHaveBeenCalled();
  expect(client.move).not.toHaveBeenCalled();
});

it('offers newly added drafts when restoring a project canvas without an open draft', async () => {
  const ref = { projectId: 'project', rootId: 'primary', path: 'new-board.design.json' };
  const pending = Promise.withResolvers<ProjectDesignEntry[]>();
  const client = testClient({ projectDesigns: () => pending.promise });
  const navigate = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const view = render(<ToastProvider><DesignWorkspace client={client} projects={projects}
    location={{ projectId: 'project', projectCanvas: true }} onLocationChange={navigate}
    translate={(key) => key} watchDirectories={() => () => undefined} /></ToastProvider>);

  const canvas = within(view.getByRole('region', { name: 'feature.design.canvas' }));
  expect(canvas.queryByText('feature.design.noProjectDrafts')).toBeNull();
  fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.documents' }), { key: 'Enter' });
  await act(async () => { pending.resolve([{ ref, documentId: 'new-board' }]); });
  const opened = await view.findByRole('menuitem', { name: 'new-board' });
  expect(canvas.queryByText('feature.design.noProjectDrafts')).toBeNull();
  fireEvent.click(opened);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ ...ref, projectCanvas: true, homeFilter: { projectId: 'project' } }));
});

it('opens another draft from the destination project when its first draft cannot resolve', async () => {
  const broken = { projectId: 'other', rootId: 'primary', path: 'a-broken.design.json' };
  const working = { projectId: 'other', rootId: 'primary', path: 'b-working.design.json' };
  const client = testClient({
    projectDesigns: async () => [{ ref: broken, documentId: 'broken' }, { ref: working, documentId: 'working' }],
    resolveResourceRoot: async (ref) => {
      if (ref.path === broken.path) throw new Error('The resource root is ambiguous');
      return ref;
    },
  });
  const navigate = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const workspace = (location: DesignWorkspaceLocation) => <ToastProvider><DesignWorkspace client={client} projects={projects}
    location={location} onLocationChange={navigate} translate={(key) => key} watchDirectories={() => () => undefined} /></ToastProvider>;
  const view = render(workspace({ projectId: 'project', rootId: 'primary', path: 'current.design.json' }));
  fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.project' }), { key: 'Enter' });
  fireEvent.click(await view.findByRole('menuitem', { name: 'Other' }));
  const fallback = { projectId: 'other', projectCanvas: true } as const;
  await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith(fallback));

  view.rerender(workspace(fallback));
  fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.documents' }), { key: 'Enter' });
  fireEvent.click(await view.findByRole('menuitem', { name: 'b-working' }));
  await waitFor(() => expect(navigate).toHaveBeenLastCalledWith({ ...working, projectCanvas: true, homeFilter: { projectId: 'other' } }));
});

it('refreshes the open project draft menu after a local draft is added during a refresh', async () => {
  const directory = { id: 'local', path: '/designs' };
  const current = { projectId: 'project', rootId: 'primary', path: 'current.design.json' };
  const added = { storageId: 'local', path: 'chat-draft.design.json' };
  const currentDrafts = [{ ref: current, documentId: 'current' }];
  const stale = Promise.withResolvers<ProjectDesignEntry[]>();
  const projectDesigns = vi.fn<DesignWorkspaceProps['client']['projectDesigns']>()
    .mockResolvedValueOnce(currentDrafts).mockReturnValueOnce(stale.promise)
    .mockResolvedValue([...currentDrafts, { ref: added, documentId: 'new' }]);
  const client = testClient({ catalog: async () => ({ directories: [directory], associations: [] }), projectDesigns });
  const watchers = new Map<string, () => void>();
  const watchDirectories: DesignWorkspaceProps['watchDirectories'] = (root, _directories, changed) => {
    watchers.set(root, changed);
    return () => { watchers.delete(root); };
  };
  const navigate = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const homeFilter = { projectId: 'project' };
  const view = render(<ToastProvider><DesignWorkspace client={client} projects={projects} watchDirectories={watchDirectories}
    location={{ ...current, homeFilter, projectCanvas: true }} onLocationChange={navigate} translate={(key) => key} /></ToastProvider>);
  await waitFor(() => expect(watchers.has(directory.path)).toBe(true));
  fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.documents' }), { key: 'Enter' });
  await view.findByRole('menuitem', { name: 'current' });
  act(() => watchers.get(directory.path)!());
  await waitFor(() => expect(projectDesigns).toHaveBeenCalledTimes(2));
  expect(view.getByRole('menuitem', { name: 'current' })).toBeTruthy();

  act(() => watchers.get(directory.path)!());
  await view.findByRole('menuitem', { name: 'chat-draft' });
  await act(async () => { stale.resolve(currentDrafts); await stale.promise; });
  fireEvent.click(view.getByRole('menuitem', { name: 'chat-draft' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith({ ...added, homeFilter, projectCanvas: true }));
});

it('shows the project linked to an externally opened draft and restores the home filter on back', async () => {
  const homeFilter = { projectId: 'project' };
  const ref = { storageId: 'local', path: 'other.design.json' };
  const client = testClient({ catalog: async () => ({ directories: [{ id: 'local', path: '/designs' }],
    associations: [{ file: '/designs/other.design.json', projectId: 'other' }] }) });
  const navigate = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const view = render(<ToastProvider><DesignWorkspace client={client} projects={projects} watchDirectories={() => () => undefined}
    location={{ ...ref, homeFilter }} onLocationChange={navigate} translate={(key) => key} /></ToastProvider>);
  const project = view.getByRole<HTMLButtonElement>('button', { name: 'feature.design.project' });
  await waitFor(() => expect(project.title).toBe('Other'));
  fireEvent.click(view.getByRole('button', { name: 'feature.design.backToDocuments' }));
  expect(navigate).toHaveBeenCalledExactlyOnceWith(homeFilter);
});

it.each([
  { platform: 'macOS', parent: '/workspace/yuri/', child: '/workspace/yuri/agent' },
  { platform: 'Windows', parent: 'C:\\Workspace\\Yuri\\', child: 'c:\\workspace\\yuri\\agent' },
])('deduplicates overlapping listings and opens with the draft resource root on $platform', async ({ parent, child }) => {
  const overlapping: DesignWorkspaceProps['projects'] = [
    { id: 'yuri', name: 'Yuri', path: parent, createdAt: '', updatedAt: '' },
    { id: 'agent', name: 'Agent', path: child, createdAt: '', updatedAt: '' },
  ];
  const source = { projectId: 'yuri', rootId: 'primary', path: 'agent/test-design.design.json' };
  const resolveResourceRoot = vi.fn().mockResolvedValue(source);
  const client = testClient({ list: async ({ projectId }) => projectId === 'yuri'
    ? ['agent/test-design.design.json', 'parent-only.design.json'] : ['test-design.design.json'], resolveResourceRoot });
  const onLocationChange = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const workspace = (location: DesignWorkspaceLocation | null) => <ToastProvider>
    <DesignWorkspace client={client} projects={overlapping} location={location} onLocationChange={onLocationChange}
      translate={(key) => key} watchDirectories={() => () => undefined} />
  </ToastProvider>;
  const view = render(workspace(null));
  await view.findByRole('button', { name: 'Yuri / parent-only.design.json' });
  const draft = await view.findByRole('button', { name: 'Agent / test-design.design.json' });
  expect(view.queryByRole('button', { name: 'Yuri / agent/test-design.design.json' })).toBeNull();
  fireEvent.click(draft);
  await waitFor(() => expect(onLocationChange).toHaveBeenLastCalledWith(source));
  expect(resolveResourceRoot).toHaveBeenLastCalledWith({ projectId: 'agent', rootId: 'primary', path: 'test-design.design.json' }, expect.any(AbortSignal));

  view.rerender(workspace({ ...source, path: 'parent-only.design.json' }));
  onLocationChange.mockClear();
  fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.documents' }), { key: 'Enter' });
  fireEvent.click(await view.findByRole('menuitem', { name: 'agent/test-design' }));
  await waitFor(() => expect(onLocationChange).toHaveBeenCalledExactlyOnceWith(source));

  view.rerender(workspace({ projectId: 'agent' }));
  fireEvent.click(await view.findByRole('button', { name: 'Agent / test-design.design.json' }));
  await waitFor(() => expect(onLocationChange).toHaveBeenLastCalledWith({ ...source, homeFilter: { projectId: 'agent' } }));
});

it('opens a newly saved local draft without any projects', async () => {
  const create = vi.fn<DesignWorkspaceProps['client']['create']>().mockResolvedValue({
    name: 'new.design.json', path: 'new.design.json', type: 'file',
  });
  const onLocationChange = vi.fn();
  const view = render(<ToastProvider><DesignWorkspace client={testClient({ create })} projects={[]} location={null}
    onLocationChange={onLocationChange} translate={(key) => key} watchDirectories={() => () => undefined} /></ToastProvider>);
  fireEvent.click(view.getByRole('button', { name: 'feature.design.newDocument' }));
  const form = within(await view.findByRole('dialog'));
  fireEvent.change(form.getByRole('textbox'), { target: { value: 'new' } });
  fireEvent.click(form.getByRole('button', { name: 'feature.design.newDocument' }));
  await waitFor(() => expect(onLocationChange).toHaveBeenCalledWith({ storageId: 'local', path: 'new.design.json' }));
  expect(create).toHaveBeenCalledExactlyOnceWith({ storageId: 'local', parentPath: '.', name: 'new.design.json' });
});

it('changes and clears a draft project without moving the source file or navigating', async () => {
  const ref = { projectId: 'project', rootId: 'secondary', path: 'draft.design.json' };
  const owner = { ref, documentId: 'draft' };
  let association: string | null | undefined;
  const setProject = vi.fn<DesignWorkspaceProps['client']['setProject']>(async (_owner, next) => {
    association = next;
    return null;
  });
  const client = testClient({
    setProject,
    list: async ({ projectId, rootId }) => projectId === ref.projectId && rootId === ref.rootId ? [ref.path] : [],
    catalog: async () => ({ directories: [], associations: association === undefined ? []
      : [{ file: '/project/secondary/draft.design.json', projectId: association }] }),
    read: async () => ({ document: { schemaVersion: designDocumentVersion, documentId: owner.documentId, rootIds: [], nodes: {} },
      revision: 'initial', canUndo: false, canRedo: false }),
  });
  const navigate = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const workspace = (location: DesignWorkspaceLocation | null) => <ToastProvider>
    <DesignWorkspace client={client} projects={projects} location={location} onLocationChange={navigate}
      translate={(key) => key} watchDirectories={() => () => undefined} />
  </ToastProvider>;
  const view = render(workspace({ projectId: 'project' }));
  const draft = { name: 'Project / secondary / draft.design.json' };
  async function selectProject(name: string) {
    fireEvent.keyDown(await view.findByRole('button', { name: 'feature.design.documentActions' }), { key: 'Enter' });
    fireEvent.keyDown(await view.findByRole('menuitem', { name: 'feature.design.linkProject' }), { key: 'ArrowRight' });
    fireEvent.click(await view.findByRole('menuitem', { name }));
    await waitFor(() => expect(view.queryByRole('button', draft)).toBeNull());
  }

  await selectProject('Other');
  expect(setProject).toHaveBeenCalledExactlyOnceWith(owner, 'other');
  view.rerender(workspace({ projectId: 'other' }));
  await view.findByRole('button', draft);
  await selectProject('feature.design.noLinkedProject');
  expect(setProject).toHaveBeenNthCalledWith(2, owner, null);

  view.rerender(workspace({ projectId: 'project' }));
  expect(view.queryByRole('button', draft)).toBeNull();
  view.rerender(workspace(null));
  await view.findByRole('button', draft);
  expect(client.move).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

it('saves a homepage draft in the chosen directory and links it to the selected project', async () => {
  const directory = { id: 'a'.repeat(64), path: '/chosen/designs' };
  const chooseDirectory = vi.fn().mockResolvedValue(directory);
  const create = vi.fn<DesignWorkspaceProps['client']['create']>().mockResolvedValue({
    name: 'new.design.json', path: 'new.design.json', type: 'file',
  });
  const client = testClient({ create });
  const navigate = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const view = render(<ToastProvider><DesignWorkspace client={{ ...client, assets: { ...client.assets, chooseDirectory } }}
    projects={projects} location={{ projectId: 'project' }} onLocationChange={navigate}
    translate={(key) => key} watchDirectories={() => () => undefined} /></ToastProvider>);

  fireEvent.click(view.getByRole('button', { name: 'feature.design.newDocument' }));
  const dialog = within(await view.findByRole('dialog'));
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'new' } });
  fireEvent.keyDown(dialog.getByRole('button', { name: 'feature.design.chooseLocation' }), { key: 'Enter' });
  fireEvent.click(await view.findByRole('menuitem', { name: 'feature.design.chooseLocation' }));
  await waitFor(() => expect(dialog.getByRole('button', { name: 'feature.design.chooseLocation' }).title).toBe(directory.path));
  fireEvent.keyDown(dialog.getByRole('combobox', { name: 'feature.design.linkProject' }), { key: 'Enter' });
  fireEvent.keyDown(await view.findByRole('option', { name: 'Other' }), { key: 'Enter' });
  fireEvent.click(dialog.getByRole('button', { name: 'feature.design.newDocument' }));

  await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith({ storageId: directory.id, path: 'new.design.json',
    homeFilter: { projectId: 'other' }, projectCanvas: true }));
  expect(create).toHaveBeenCalledExactlyOnceWith({ storageId: directory.id, parentPath: '.', name: 'new.design.json', linkedProjectId: 'other' });
});

it.each([
  { label: 'the open draft folder', location: { projectId: 'project', rootId: 'secondary', path: 'screens/open.design.json' },
    rootId: 'secondary', parentPath: 'screens', path: 'screens/新建设计稿 2.design.json' },
  { label: 'the empty project', location: { projectId: 'project', projectCanvas: true } as const,
    rootId: 'primary', parentPath: '.', path: '新建设计稿 2.design.json' },
])('creates and opens a numbered draft directly from the menu for $label', async ({ location, rootId, parentPath, path }) => {
  const create = vi.fn<DesignWorkspaceProps['client']['create']>().mockResolvedValue({ name: '新建设计稿 2.design.json', path, type: 'file' });
  const navigate = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const view = render(<ToastProvider><DesignWorkspace client={testClient({ create })} projects={projects} location={location}
    onLocationChange={navigate} translate={(key) => key === 'feature.design.newDraft' ? '新建设计稿' : key}
    watchDirectories={() => () => undefined} /></ToastProvider>);
  fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.documents' }), { key: 'Enter' });
  fireEvent.click(await view.findByRole('menuitem', { name: '新建设计稿' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith({ projectId: 'project', rootId, path,
    ...('projectCanvas' in location ? { projectCanvas: true, homeFilter: { projectId: 'project' } } : {}) }));
  expect(create).toHaveBeenCalledExactlyOnceWith({ projectId: 'project', rootId, parentPath, name: '新建设计稿.design.json', autoNumber: true });
  expect(view.queryByRole('dialog')).toBeNull();
});

it('chooses the move destination using the source behind an overlapping catalog entry', async () => {
  const overlapping: DesignWorkspaceProps['projects'] = [projects[0], { ...projects[1], path: '/project/primary/child' }];
  const listed = { projectId: 'project', rootId: 'primary', path: 'child/screens/overview.design.json' };
  const source = { projectId: 'other', rootId: 'primary', path: 'screens/overview.design.json' };
  const { promise: pendingSource, resolve: resolveSource } = Promise.withResolvers<typeof source>();
  const resolveResourceRoot = vi.fn<DesignWorkspaceProps['client']['resolveResourceRoot']>().mockReturnValue(pendingSource);
  const destination = { storageId: 'local', path: 'overview.design.json' };
  const transfer = Promise.withResolvers<typeof destination>();
  const move = vi.fn<DesignWorkspaceProps['client']['move']>().mockReturnValue(transfer.promise);
  const list: DesignWorkspaceProps['client']['list'] = async ({ projectId, rootId }) =>
    projectId === listed.projectId && rootId === listed.rootId ? [listed.path] : [];
  const onLocationChange = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const initial: DesignSnapshot = { document: { schemaVersion: designDocumentVersion, documentId: 'overview', rootIds: [], nodes: {} },
    revision: 'initial', canUndo: false, canRedo: false };
  const saving = Promise.withResolvers<DesignSnapshot>();
  const commit = vi.fn<DesignWorkspaceProps['client']['commit']>().mockReturnValue(saving.promise);
  const client = testClient({ list, move, resolveResourceRoot, read: async () => initial, commit });
  const translate = (key: string) => key;
  const editor = renderHook(() => useDesignDocument({ client, documentRef: listed, translate }), { wrapper: ToastProvider });
  const view = render(<ToastProvider><DesignWorkspace client={client} projects={overlapping} location={null}
    onLocationChange={onLocationChange} translate={(key) => key} watchDirectories={() => () => undefined} /></ToastProvider>);
  await view.findByRole('button', { name: 'Project / primary / child/screens/overview.design.json' });
  fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.documentActions' }), { key: 'Enter' });
  fireEvent.click(await view.findByRole('menuitem', { name: 'feature.design.moveDocument' }));
  expect(resolveResourceRoot).toHaveBeenCalledWith(listed, expect.any(AbortSignal));
  expect(view.queryByRole('dialog')).toBeNull();
  await act(async () => { resolveSource(source); await pendingSource; });
  const dialog = within(await view.findByRole('dialog'));
  expect(onLocationChange).not.toHaveBeenCalled();
  const submit = dialog.getByRole<HTMLButtonElement>('button', { name: 'feature.design.moveDocumentConfirm' });
  const insert = () => editor.result.current.commit([{ kind: 'insert', nodeId: 'tile', parentId: null,
    node: { kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 } }], editor.result.current.currentRevision()!);
  try {
    act(() => { void insert(); });
    await waitFor(() => expect(commit).toHaveBeenCalledOnce());
    fireEvent.click(submit);
    await act(async () => { saving.resolve({ ...initial, revision: 'saved' }); });
    await waitFor(() => expect(move).toHaveBeenCalledOnce());
    // A second submission through the other root must never target the old path.
    await act(async () => { expect(await insert()).toBe(false); });
    expect(commit).toHaveBeenCalledOnce();
  } finally {
    saving.resolve(initial);
    await act(async () => { transfer.resolve(destination); });
  }
  await waitFor(() => expect(onLocationChange).toHaveBeenCalledWith(destination));
  expect(move).toHaveBeenCalledExactlyOnceWith({
    ref: source,
    destination: { storageId: 'local' },
  });
  expect(resolveResourceRoot).toHaveBeenCalledTimes(1);
});

it('lists a new draft after a directory change arrives during the refresh following deletion', async () => {
  const deleted = 'deleted.design.json';
  const added = 'added.design.json';
  const modifiedAt = '2026-10-01T00:00:00.000Z';
  type ListEntries = DesignWorkspaceProps['client']['listEntries'];
  const refresh = Promise.withResolvers<Awaited<ReturnType<ListEntries>>>();
  const listEntries = vi.fn<ListEntries>().mockResolvedValueOnce([{ path: deleted, modifiedAt }])
    .mockReturnValueOnce(refresh.promise).mockResolvedValue([{ path: added, modifiedAt }]);
  const remove = vi.fn<DesignWorkspaceProps['client']['delete']>().mockResolvedValue(null);
  let directoryChanged: (() => void) | undefined;
  const watchDirectories: DesignWorkspaceProps['watchDirectories'] = (_root, _paths, changed) => {
    directoryChanged = changed;
    return () => { directoryChanged = undefined; };
  };
  const view = render(<ToastProvider><DesignWorkspace client={testClient({ listEntries, delete: remove })} projects={[projects[1]]} location={null}
    onLocationChange={vi.fn()} translate={(key) => key} watchDirectories={watchDirectories} /></ToastProvider>);
  try {
    const recent = within(await view.findByRole('region', { name: 'feature.design.catalog.recent' }));
    const all = within(view.getByRole('region', { name: 'feature.design.catalog.all' }));
    fireEvent.click(view.getByRole('button', { name: 'feature.design.catalog.list' }));
    expect(all.getByRole('button', { name: `Other / ${deleted}` })).toBeDefined();
    fireEvent.keyDown(recent.getByRole('button', { name: 'feature.design.documentActions' }), { key: 'Enter' });
    fireEvent.click(await view.findByRole('menuitem', { name: 'feature.design.deleteDocument' }));
    fireEvent.click(within(await view.findByRole('dialog')).getByRole('button', { name: 'feature.design.deleteDocument' }));
    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(2));
    expect(remove).toHaveBeenCalledExactlyOnceWith({ projectId: 'other', rootId: 'primary', path: deleted });

    act(() => directoryChanged?.());
    await act(async () => { refresh.resolve([]); await refresh.promise; });

    const refreshed = within(await view.findByRole('region', { name: 'feature.design.catalog.all' }));
    await refreshed.findByRole('button', { name: `Other / ${added}` });
    expect(view.queryAllByRole('button', { name: `Other / ${deleted}` })).toHaveLength(0);
  } finally {
    refresh.resolve([]);
  }
});

it('deletes a catalog draft only after confirmation and keeps the chosen filter', async () => {
  const onLocationChange = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const scope = { projectId: 'project', rootId: 'secondary' };
  const ref = { ...scope, path: 'screens/overview.design.json' };
  let paths = [ref.path];
  const remove = vi.fn<DesignWorkspaceProps['client']['delete']>(async () => { paths = []; return null; });
  const client = testClient({ list: async (root) => root.projectId === scope.projectId && root.rootId === scope.rootId ? paths : [], delete: remove });
  const workspace = (visible: boolean) => <ToastProvider><DesignWorkspace client={client} projects={projects} visible={visible}
    location={scope} onLocationChange={onLocationChange} translate={(key) => key}
    watchDirectories={() => () => undefined} /></ToastProvider>;
  const view = render(workspace(true));
  const openDelete = async () => {
    const opener = await view.findByRole('button', { name: 'feature.design.documentActions' });
    opener.focus();
    fireEvent.keyDown(opener, { key: 'Enter' });
    fireEvent.click(await view.findByRole('menuitem', { name: 'feature.design.deleteDocument' }));
    const dialog = await view.findByRole('dialog', { name: 'feature.design.deleteDocumentTitle' });
    return { opener, dialog: within(dialog) };
  };
  const first = await openDelete();
  fireEvent.click(first.dialog.getByRole('button', { name: 'feature.design.cancel' }));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(first.opener));
  expect(remove).not.toHaveBeenCalled();
  expect(onLocationChange).not.toHaveBeenCalled();

  await openDelete();
  view.rerender(workspace(false));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  view.rerender(workspace(true));
  await view.findByRole('button', { name: 'feature.design.documentActions' });
  expect(view.queryByRole('dialog')).toBeNull();
  expect(remove).not.toHaveBeenCalled();

  const { dialog } = await openDelete();
  fireEvent.click(dialog.getByRole('button', { name: 'feature.design.deleteDocument' }));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(remove).toHaveBeenCalledExactlyOnceWith(ref);
  expect(onLocationChange).not.toHaveBeenCalled();
});
