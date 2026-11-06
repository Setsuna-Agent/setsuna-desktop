// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodePatchView } from '../../../../src/shared/code/PierreCode.js';
import { codeDiffLinesToPatch, type CodeDiffLine } from '../../../../src/shared/code/diffPatch.js';
import { WorkspaceContentFind } from '../../../../src/features/workspace/WorkspaceContentFind.js';
import { CONTENT_FIND_REQUEST } from '../../../../src/shared/find/useContentFindTarget.js';

const highlights = new Map<string, Set<Range>>();
beforeEach(() => {
  vi.stubGlobal('Highlight', class extends Set<Range> {
    priority = 0;
    constructor(...ranges: Range[]) { super(ranges); }
  });
  vi.stubGlobal('CSS', { highlights });
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 10, 50, 20));
});
afterEach(() => { cleanup(); highlights.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('CodePatchView patch updates', () => {
  it.each([false, true])('replaces same-path diff contents without reopening (virtualized=%s)', async (virtualized) => {
    const contents = ['id,value', '1,old', '2,keep', '3,new'];
    const unstagedPatch = patch('Created', contents.map((content, index) => ({
      type: 'added', newLine: index + 1, content,
    })));
    const latestPatch = patch('Modified', [
      { type: 'context', oldLine: 3, newLine: 3, content: '2,keep' },
      { type: 'added', newLine: 4, content: '3,new' },
    ]);
    const refreshedPatch = patch('Modified', [
      { type: 'context', oldLine: 3, newLine: 3, content: '2,keep' },
      { type: 'removed', oldLine: 4, content: '3,new' },
      { type: 'added', newLine: 4, content: '3,updated' },
    ]);
    const surface = (value: string) => <WorkspaceContentFind placement="side"><CodePatchView patch={value} layout="split" virtualized={virtualized} /></WorkspaceContentFind>;
    const view = render(surface(unstagedPatch));
    const container = view.container.querySelector('diffs-container');
    const lines = (type: 'change-addition' | 'change-deletion') => Array.from(
      container?.shadowRoot?.querySelectorAll(`[data-line][data-line-type="${type}"]`) ?? [],
      (line) => line.textContent?.trim(),
    );

    await waitFor(() => expect(lines('change-addition')).toEqual(contents));
    act(() => view.container.querySelector('[data-content-find-scope]')!.dispatchEvent(new Event(CONTENT_FIND_REQUEST)));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索当前面板内容' }), { target: { value: 'new' } });
    const activeType = () => [...(highlights.get('content-find-active') ?? [])][0]
      ?.startContainer.parentElement?.closest<HTMLElement>('[data-line-type]')?.dataset.lineType;
    await waitFor(() => expect(activeType()).toBe('change-addition'));

    // Switching review sources keeps the same file open but changes its baseline.
    view.rerender(surface(latestPatch));
    await waitFor(() => expect(lines('change-addition')).toEqual(['3,new']));
    expect(lines('change-deletion')).toEqual([]);

    // A refresh can change the content again without changing the path or source.
    view.rerender(surface(refreshedPatch));
    await waitFor(() => {
      expect(lines('change-addition')).toEqual(['3,updated']);
      expect(lines('change-deletion')).toEqual(['3,new']);
    });
    await waitFor(() => expect(activeType()).toBe('change-deletion'));

    view.rerender(surface(unstagedPatch));
    await waitFor(() => expect(lines('change-addition')).toEqual(contents));
    expect(lines('change-deletion')).toEqual([]);
    expect(view.container.querySelector('diffs-container')).toBe(container);
  });
});

function patch(action: 'Created' | 'Modified', lines: CodeDiffLine[]): string {
  return codeDiffLinesToPatch({ action, lines, path: 'sample-data.csv' });
}
