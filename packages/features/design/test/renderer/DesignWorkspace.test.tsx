// @vitest-environment happy-dom
import { ToastProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, renderHook, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DesignWorkspace, { type DesignWorkspaceLocation, type DesignWorkspaceProps } from '../../src/renderer/DesignWorkspace.js';
import { designDocumentVersion, type DesignSnapshot } from '../../src/contracts/index.js';
import { useDesignDocument } from '../../src/renderer/use-design-document.js';

vi.mock('../../src/renderer/DesignDocumentSurface.js', () => ({ DesignDocumentSurface: () => null }));

afterEach(cleanup);

const projects: DesignWorkspaceProps['projects'] = [{ id: 'project', name: 'Project', createdAt: '', updatedAt: '', roots: [
  { id: 'primary', path: '/project/primary' }, { id: 'secondary', path: '/project/secondary' },
] }, { id: 'other', name: 'Other', createdAt: '', updatedAt: '', path: '/other' }];

function testClient(operations: Partial<DesignWorkspaceProps['client']>): DesignWorkspaceProps['client'] {
  return {
    fonts: { list: vi.fn().mockResolvedValue([]), import: vi.fn(), read: vi.fn(), remove: vi.fn() },
    assets: { search: vi.fn(), read: vi.fn(), readLinkedImage: vi.fn(), requestClipboardPaste: vi.fn(), output: {
      saveDesignHtml: vi.fn(), saveDesignSvg: vi.fn(), saveImageAs: vi.fn(), copyImageToClipboard: vi.fn(),
      copyDesignLayers: vi.fn(), readDesignLayers: vi.fn(), copyText: vi.fn(),
    } },
    list: vi.fn().mockResolvedValue([]), create: vi.fn(), move: vi.fn(), delete: vi.fn(), importImage: vi.fn(), read: vi.fn(), commit: vi.fn(), navigate: vi.fn(),
    importScript: vi.fn(), readScriptParameters: vi.fn(), renderScript: vi.fn(), importShader: vi.fn(), readShader: vi.fn(),
    resolveResourceRoot: async (ref) => ref,
    ...operations,
  };
}

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
    onAddProject: vi.fn(),
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
      translate={(key) => key} watchDirectories={() => () => undefined} onAddProject={vi.fn()} />
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
  fireEvent.keyDown(view.getByRole('combobox', { name: 'feature.design.documents' }), { key: 'Enter' });
  fireEvent.keyDown(await view.findByRole('option', { name: 'agent/test-design' }), { key: 'Enter' });
  await waitFor(() => expect(onLocationChange).toHaveBeenCalledExactlyOnceWith(source));

  view.rerender(workspace({ projectId: 'agent' }));
  fireEvent.click(await view.findByRole('button', { name: 'Agent / test-design.design.json' }));
  await waitFor(() => expect(onLocationChange).toHaveBeenLastCalledWith({ ...source, homeFilter: { projectId: 'agent' } }));
});

it('creates a draft in the project and folder chosen from the unfiltered catalog', async () => {
  const create = vi.fn<DesignWorkspaceProps['client']['create']>().mockResolvedValue({
    name: 'new.design.json', path: 'new.design.json', type: 'file',
  });
  const onLocationChange = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const view = render(<ToastProvider><DesignWorkspace client={testClient({ create })} projects={projects} location={null}
    onLocationChange={onLocationChange} translate={(key) => key} watchDirectories={() => () => undefined} onAddProject={vi.fn()} /></ToastProvider>);
  fireEvent.click(view.getByRole('button', { name: 'feature.design.newDocument' }));
  const form = within(await view.findByRole('dialog', { name: 'feature.design.newDocument' }));
  const name = form.getByRole('textbox', { name: 'feature.design.name' });
  fireEvent.change(name, { target: { value: 'new' } });
  const save = form.getByRole<HTMLButtonElement>('button', { name: 'feature.design.newDocument' });
  expect(save.disabled).toBe(true);
  fireEvent.keyDown(form.getByRole('combobox', { name: 'feature.design.project' }), { key: 'Enter' });
  fireEvent.keyDown(await view.findByRole('option', { name: 'Project' }), { key: 'Enter' });
  await waitFor(() => expect(view.queryByRole('listbox')).toBeNull());
  expect(save.disabled).toBe(true);
  fireEvent.keyDown(form.getByRole('combobox', { name: 'feature.design.directory' }), { key: 'Enter' });
  fireEvent.keyDown(await view.findByRole('option', { name: 'secondary' }), { key: 'Enter' });
  fireEvent.click(save);
  await waitFor(() => expect(onLocationChange).toHaveBeenCalledWith({ projectId: 'project', rootId: 'secondary', path: 'new.design.json' }));
  expect(create).toHaveBeenCalledExactlyOnceWith({ projectId: 'project', rootId: 'secondary', parentPath: '.', name: 'new.design.json' });
});

it('chooses the move destination using the source behind an overlapping catalog entry', async () => {
  const overlapping: DesignWorkspaceProps['projects'] = [projects[0], { ...projects[1], path: '/project/primary/child' }];
  const listed = { projectId: 'project', rootId: 'primary', path: 'child/screens/overview.design.json' };
  const source = { projectId: 'other', rootId: 'primary', path: 'screens/overview.design.json' };
  const { promise: pendingSource, resolve: resolveSource } = Promise.withResolvers<typeof source>();
  const resolveResourceRoot = vi.fn<DesignWorkspaceProps['client']['resolveResourceRoot']>().mockReturnValue(pendingSource);
  const destination = { projectId: 'project', rootId: 'secondary', path: 'overview.design.json' };
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
    onLocationChange={onLocationChange} translate={(key) => key} watchDirectories={() => () => undefined} onAddProject={vi.fn()} /></ToastProvider>);
  await view.findByRole('button', { name: 'Project / primary / child/screens/overview.design.json' });
  fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.documentActions' }), { key: 'Enter' });
  fireEvent.click(await view.findByRole('menuitem', { name: 'feature.design.moveDocument' }));
  expect(resolveResourceRoot).toHaveBeenCalledWith(listed, expect.any(AbortSignal));
  expect(view.queryByRole('dialog')).toBeNull();
  await act(async () => { resolveSource(source); await pendingSource; });
  const dialog = within(await view.findByRole('dialog'));
  expect(onLocationChange).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog.getByRole('combobox', { name: 'feature.design.project' }), { key: 'Enter' });
  expect(view.queryByRole('option', { name: 'Other' })).toBeNull();
  fireEvent.keyDown(await view.findByRole('option', { name: 'Project' }), { key: 'Enter' });
  await waitFor(() => expect(view.queryByRole('listbox')).toBeNull());
  const submit = dialog.getByRole<HTMLButtonElement>('button', { name: 'feature.design.moveDocumentConfirm' });
  expect(submit.disabled).toBe(true);
  fireEvent.keyDown(dialog.getByRole('combobox', { name: 'feature.design.directory' }), { key: 'Enter' });
  fireEvent.keyDown(await view.findByRole('option', { name: 'secondary' }), { key: 'Enter' });
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
    destination: { projectId: 'project', rootId: 'secondary' },
  });
  expect(resolveResourceRoot).toHaveBeenCalledTimes(1);
});

it('lists a new draft after a directory change arrives during the refresh following deletion', async () => {
  const deleted = 'deleted.design.json';
  const added = 'added.design.json';
  const refresh = Promise.withResolvers<readonly string[]>();
  const list = vi.fn<DesignWorkspaceProps['client']['list']>().mockResolvedValueOnce([deleted])
    .mockReturnValueOnce(refresh.promise).mockResolvedValue([added]);
  const remove = vi.fn<DesignWorkspaceProps['client']['delete']>().mockResolvedValue(null);
  let directoryChanged: (() => void) | undefined;
  const watchDirectories: DesignWorkspaceProps['watchDirectories'] = (_root, _paths, changed) => {
    directoryChanged = changed;
    return () => { directoryChanged = undefined; };
  };
  const view = render(<ToastProvider><DesignWorkspace client={testClient({ list, delete: remove })} projects={[projects[1]]} location={null}
    onLocationChange={vi.fn()} translate={(key) => key} watchDirectories={watchDirectories} onAddProject={vi.fn()} /></ToastProvider>);
  try {
    await view.findByRole('button', { name: `Other / ${deleted}` });
    fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.documentActions' }), { key: 'Enter' });
    fireEvent.click(await view.findByRole('menuitem', { name: 'feature.design.deleteDocument' }));
    fireEvent.click(within(await view.findByRole('dialog')).getByRole('button', { name: 'feature.design.deleteDocument' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    act(() => directoryChanged?.());
    await act(async () => { refresh.resolve([]); await refresh.promise; });

    await view.findByRole('button', { name: `Other / ${added}` });
    expect(view.queryByRole('button', { name: `Other / ${deleted}` })).toBeNull();
  } finally {
    refresh.resolve([]);
  }
});

it('deletes the active draft only after confirmation and returns to its previous filter', async () => {
  const remove = vi.fn<DesignWorkspaceProps['client']['delete']>().mockResolvedValue(null);
  const onLocationChange = vi.fn<DesignWorkspaceProps['onLocationChange']>();
  const scope = { projectId: 'project', rootId: 'secondary' };
  const ref = { ...scope, path: 'screens/overview.design.json' };
  const view = render(<ToastProvider><DesignWorkspace client={testClient({ delete: remove })} projects={projects}
    location={{ ...ref, homeFilter: scope }} onLocationChange={onLocationChange} translate={(key) => key}
    watchDirectories={() => () => undefined} onAddProject={vi.fn()} /></ToastProvider>);
  const openDelete = async () => {
    fireEvent.keyDown(view.getByRole('button', { name: 'feature.design.documentActions' }), { key: 'Enter' });
    fireEvent.click(await view.findByRole('menuitem', { name: 'feature.design.deleteDocument' }));
    return within(await view.findByRole('dialog'));
  };
  const first = await openDelete();
  fireEvent.click(first.getByRole('button', { name: 'feature.design.cancel' }));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(remove).not.toHaveBeenCalled();
  expect(onLocationChange).not.toHaveBeenCalled();

  const second = await openDelete();
  fireEvent.click(second.getByRole('button', { name: 'feature.design.deleteDocument' }));
  await waitFor(() => expect(onLocationChange).toHaveBeenCalledExactlyOnceWith(scope));
  expect(remove).toHaveBeenCalledExactlyOnceWith(ref);
});
