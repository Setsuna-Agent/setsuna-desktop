// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkspaceEditorDocument } from '../../../../../src/features/workspace/editor/useWorkspaceEditorDocument.js';

afterEach(cleanup);

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
