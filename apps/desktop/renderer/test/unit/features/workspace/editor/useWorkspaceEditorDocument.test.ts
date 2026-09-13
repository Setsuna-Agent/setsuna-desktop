// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkspaceEditorDocument } from '../../../../../src/features/workspace/editor/useWorkspaceEditorDocument.js';

afterEach(cleanup);

it('acknowledges delayed input echoes without replacing newer edits', () => {
  const view = renderHook(({ content, revision }) => useWorkspaceEditorDocument({ content,
    file: { projectId: 'project', path: 'test123', revision }, onChange: vi.fn(),
  }), { initialProps: { content: '', revision: 'revision-1' } });
  const initialItems = view.result.current.items;
  const type = (contents: string) => act(() => {
    view.result.current.onEditorChange(initialItems[0]!, { name: 'test123', contents });
  });

  // Native input can advance while React is still committing an earlier draft.
  type('1');
  type('12');
  type('123');
  view.rerender({ content: '1', revision: 'revision-1' });
  expect(view.result.current.items).toBe(initialItems);
  type('1234');
  view.rerender({ content: '123', revision: 'revision-1' });
  expect(view.result.current.items).toBe(initialItems);
  view.rerender({ content: '1234', revision: 'revision-2' });
  expect(view.result.current.items).toBe(initialItems);

  // A later external replacement may equal a previously acknowledged local edit.
  view.rerender({ content: '1', revision: 'revision-3' });
  expect(view.result.current.items[0]).toMatchObject({ version: 1, file: { contents: '1' } });
});

it('publishes external document replacements while keeping input and save echoes out of CodeView reconciliation', () => {
  const onChange = vi.fn();
  const view = renderHook(({ content, revision }) => useWorkspaceEditorDocument({ content,
    file: { projectId: 'project', path: 'README.md', revision }, onChange,
  }), { initialProps: { content: '# Original', revision: 'revision-1' } });
  const initialItems = view.result.current.items;
  act(() => view.result.current.onEditorChange(initialItems[0]!, { name: 'README.md', contents: '# Local edit' }));
  expect(onChange).toHaveBeenLastCalledWith('# Local edit');
  view.rerender({ content: '# Local edit', revision: 'revision-1' });
  expect(view.result.current.items).toBe(initialItems);
  view.rerender({ content: '# Local edit', revision: 'revision-2' });
  expect(view.result.current.items).toBe(initialItems);

  view.rerender({ content: '# External edit', revision: 'revision-3' });
  const refreshedItems = view.result.current.items;
  expect(refreshedItems[0]).toMatchObject({ id: 'project:README.md', edit: true, version: 1,
    file: { name: 'README.md', contents: '# External edit' } });
  expect(refreshedItems).not.toBe(initialItems);
  act(() => view.result.current.onEditorChange(refreshedItems[0]!, { name: 'README.md', contents: '# Next edit' }));
  view.rerender({ content: '# Next edit', revision: 'revision-3' });
  expect(view.result.current.items).toBe(refreshedItems);
});
