import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimeFileDiffPreview } from '../../../../../src/features/chat/tool-runs/RuntimeFileDiffPreview.js';

describe('RuntimeFileDiffPreview', () => {

  it('bounds a single large diff before rendering highlighted rows', () => {
    const html = renderToStaticMarkup(createElement(RuntimeFileDiffPreview, {
      change: {
        path: 'src/generated.ts',
        action: 'Created',
        additions: 300,
        deletions: 0,
        truncated: false,
        lines: Array.from({ length: 300 }, (_, index) => ({
          type: 'added' as const,
          newLine: index + 1,
          content: `export const value${index + 1} = ${index + 1};`,
        })),
      },
    }));

    expect(html.match(/\+export const value/gu)).toHaveLength(240);
    expect(html).toContain('Diff 内容过长，仅显示部分改动。');
  });
});
