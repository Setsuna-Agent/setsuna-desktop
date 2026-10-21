// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastNotice, ToastProvider } from '../src/toast/provider.js';
import type { ToastEntry } from '../src/toast/stack.js';

let entries: ToastEntry[] = [];
vi.mock('../src/toast/stack.js', () => ({
  ToastStack: (props: { entries: ToastEntry[] }) => { entries = props.entries; return null; },
}));
afterEach(() => { cleanup(); entries = []; });

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
