// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CodePatchView } from '../../../../src/shared/code/PierreCode.js';
import { codeDiffLinesToPatch, type CodeDiffLine } from '../../../../src/shared/code/diffPatch.js';

afterEach(cleanup);

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
    const surface = (value: string) => <CodePatchView patch={value} layout="split" virtualized={virtualized} />;
    const view = render(surface(unstagedPatch));
    const container = view.container.querySelector('diffs-container');
    const lines = (type: 'change-addition' | 'change-deletion') => Array.from(
      container?.shadowRoot?.querySelectorAll(`[data-line][data-line-type="${type}"]`) ?? [],
      (line) => line.textContent?.trim(),
    );

    await waitFor(() => expect(lines('change-addition')).toEqual(contents));

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

    view.rerender(surface(unstagedPatch));
    await waitFor(() => expect(lines('change-addition')).toEqual(contents));
    expect(lines('change-deletion')).toEqual([]);
    expect(view.container.querySelector('diffs-container')).toBe(container);
  });
});

function patch(action: 'Created' | 'Modified', lines: CodeDiffLine[]): string {
  return codeDiffLinesToPatch({ action, lines, path: 'sample-data.csv' });
}
