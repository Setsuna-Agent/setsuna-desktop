import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimeFileDiffPreview } from '../../../../../src/features/chat/tool-runs/RuntimeFileDiffPreview.js';

describe('RuntimeFileDiffPreview', () => {
  it('renders a valid Pierre patch and truncation feedback', () => {
    const html = renderToStaticMarkup(createElement(RuntimeFileDiffPreview, {
      change: {
        path: 'src/RuntimeErrorNotice.tsx',
        action: 'Edited',
        additions: 1,
        deletions: 1,
        truncated: true,
        lines: [
          { type: 'context', oldLine: 16, newLine: 16, content: 'export function notice() {' },
          { type: 'removed', oldLine: 17, content: "  return 'before';" },
          { type: 'added', newLine: 17, content: "  return 'after';" },
          { type: 'gap', content: '7 unmodified lines' },
        ],
      },
    }));

    expect(html).toContain('aria-label="src/RuntimeErrorNotice.tsx 的文件改动"');
    expect(html).toContain('diff --git a/src/RuntimeErrorNotice.tsx b/src/RuntimeErrorNotice.tsx');
    expect(html).toContain('@@ -16,2 +16,2 @@');
    expect(html).toContain("-  return &#x27;before&#x27;;");
    expect(html).toContain("+  return &#x27;after&#x27;;");
    expect(html).toContain('Diff 内容过长，仅显示部分改动。');
  });

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
