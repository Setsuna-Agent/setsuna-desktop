import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimeFileDiffPreview } from '../../../../../src/features/chat/tool-runs/RuntimeFileDiffPreview.js';

describe('RuntimeFileDiffPreview', () => {
  it('renders compact highlighted diff rows and truncation feedback', () => {
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
    expect(html).toContain('chat-file-diff__line--context');
    expect(html).toContain('chat-file-diff__line--removed');
    expect(html).toContain('chat-file-diff__line--added');
    expect(html).toContain('token keyword');
    expect(html).toContain('省略 7 行未改动内容');
    expect(html).toContain('Diff 内容过长，仅显示部分改动。');
  });
});
