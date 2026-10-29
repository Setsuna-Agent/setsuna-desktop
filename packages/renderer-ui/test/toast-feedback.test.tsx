// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastNotice, ToastProvider, useToast, type ToastApi } from '../src/toast/provider.js';
import type { ToastEntry } from '../src/toast/stack.js';

let entries: ToastEntry[] = [];
vi.mock('../src/toast/stack.js', () => ({
  ToastStack: (props: { entries: ToastEntry[] }) => { entries = props.entries; return null; },
}));
afterEach(() => { cleanup(); entries = []; });

it('waits to display later notifications without removing an unresolved failure', () => {
  let api!: ToastApi;
  function Capture() { api = useToast(); return null; }
  render(<ToastProvider><Capture /></ToastProvider>);
  act(() => {
    api.error('Unsaved settings', { durationMs: null });
    for (let index = 0; index < 4; index += 1) api.info(`Notice ${index}`);
  });
  expect(entries.map((entry) => entry.message)).toEqual(['Unsaved settings', 'Notice 0', 'Notice 1', 'Notice 2']);
  act(() => api.dismiss(entries[1].id));
  expect(entries.map((entry) => entry.message)).toEqual(['Unsaved settings', 'Notice 1', 'Notice 2', 'Notice 3']);
});

it('reports a failure once, clears it with its owner, and permits the same failure on a later attempt', () => {
  const tree = (message: string | null, visible = true) => <ToastProvider label="Notifications" closeLabel="Close">
    {visible ? <ToastNotice message={message} /> : null}
  </ToastProvider>;
  const view = render(tree('Save failed'));
  expect(entries).toEqual([expect.objectContaining({ message: 'Save failed', tone: 'error' })]);
  const initialId = entries[0].id;
  view.rerender(tree('Save failed'));
  expect(entries.map((entry) => entry.id)).toEqual([initialId]);
  view.rerender(tree(null));
  expect(entries).toEqual([]);
  view.rerender(tree('Save failed'));
  expect(entries).toHaveLength(1);
  expect(entries[0].id).toBeGreaterThan(initialId);
  view.rerender(tree('Save failed', false));
  expect(entries).toEqual([]);
});
