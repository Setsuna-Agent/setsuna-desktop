// @vitest-environment happy-dom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { useWorkspaceEntryDrag } from '../../../../../src/features/workspace/hooks/useWorkspaceEntryDrag.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const file: WorkspaceEntry = { type: 'file', name: 'report.pdf', path: 'report.pdf' };
const folder: WorkspaceEntry = { type: 'directory', name: 'docs', path: 'docs' };

function setup() {
  const startFileDrag = vi.fn().mockResolvedValue({ ok: true });
  const resolveWorkspaceFileDrop = vi.fn().mockResolvedValue(file.path);
  vi.stubGlobal('setsunaDesktop', { desktop: { startFileDrag, resolveWorkspaceFileDrop } });
  const moveEntry = vi.fn(async (entryPath: string, parentPath: string) => ({ ...file, path: `${parentPath}/${entryPath}` }));
  const onMoved = vi.fn();
  function Tree({ root = '/repo', disabled = false }: { root?: string; disabled?: boolean }) {
    const drag = useWorkspaceEntryDrag({ projectId: 'project', workspaceRoot: root, disabled,
      entries: [file, folder], moveEntry, onMoved });
    return <>
      <button draggable onDragStart={(event) => drag.startDrag(event, file)}>file</button>
      <button draggable onDragStart={(event) => drag.startDrag(event, folder)}>directory</button>
      <div data-testid="target" onDragOver={(event) => drag.dragOver(event, 'target')}
        onDrop={(event) => drag.drop(event, 'target')} />
    </>;
  }
  const view = render(<ToastProvider><Tree /></ToastProvider>);
  const data = new DataTransfer();
  data.items.add(new File(['pdf'], file.name, { type: 'application/pdf' }));
  return { ...view, startFileDrag, resolveWorkspaceFileDrop, moveEntry, onMoved, data,
    changeRoot: (root: string, disabled = false) => view.rerender(<ToastProvider><Tree root={root} disabled={disabled} /></ToastProvider>),
    target: screen.getByTestId('target') };
}

it('exports a file natively and accepts its OS payload back into the existing tree move flow', async () => {
  const view = setup();
  expect(fireEvent.dragStart(screen.getByText('file'))).toBe(false);
  expect(view.startFileDrag).toHaveBeenCalledExactlyOnceWith({ kind: 'workspace-file', workspaceRoot: '/repo', filePath: file.path });
  const over = createEvent.dragOver(view.target, { dataTransfer: view.data });
  fireEvent(view.target, over);
  expect((over as DragEvent).dataTransfer?.dropEffect).toBe('copy');
  fireEvent.drop(view.target, { dataTransfer: view.data });
  await waitFor(() => expect(view.onMoved).toHaveBeenCalledWith({ ...file, path: 'target/report.pdf' }, file.path));
  expect(view.resolveWorkspaceFileDrop).toHaveBeenCalledWith('/repo', expect.any(File));
  expect(view.moveEntry).toHaveBeenCalledExactlyOnceWith(file.path, 'target');
});

it('keeps directory drags internal and does not turn foreign file drops into tree moves', async () => {
  const view = setup();
  const internal = new DataTransfer();
  internal.setDragImage = vi.fn();
  fireEvent.dragStart(screen.getByText('directory'), { dataTransfer: internal });
  fireEvent.drop(view.target, { dataTransfer: internal });
  await waitFor(() => expect(view.moveEntry).toHaveBeenCalledExactlyOnceWith('docs', 'target'));
  expect(view.startFileDrag).not.toHaveBeenCalled();
  view.moveEntry.mockClear();
  view.resolveWorkspaceFileDrop.mockResolvedValue(null);
  await act(async () => { fireEvent.drop(view.target, { dataTransfer: view.data }); });
  expect(view.moveEntry).not.toHaveBeenCalled();
});

it.each(['switch', 'disabled'] as const)('ignores late drop resolution after the workspace is %s', async (change) => {
  const view = setup();
  let resolve!: (path: string) => void;
  view.resolveWorkspaceFileDrop.mockImplementationOnce(() => new Promise<string>((settle) => { resolve = settle; }));
  fireEvent.drop(view.target, { dataTransfer: view.data });
  view.changeRoot(change === 'switch' ? '/another' : '/repo', change === 'disabled');
  await act(async () => { resolve(file.path); });
  expect(view.moveEntry).not.toHaveBeenCalled();
  expect(view.onMoved).not.toHaveBeenCalled();
});
