import { describe, expect, it } from 'vitest';
import { splitOpenUiContent } from '../../../../../src/features/chat/generative-ui/openUiContent.js';

describe('OpenUI message framing', () => {
  it('keeps the original incomplete program separate from Markdown repair', () => {
    const source = 'Before\n\n```openui\nroot = Stack([TextContent("partial';
    expect(splitOpenUiContent(source)).toEqual([
      { kind: 'markdown', key: 'markdown-0', content: 'Before\n\n' },
      { kind: 'openui', key: 'openui-0', content: 'root = Stack([TextContent("partial', closed: false, offset: 8 },
      { kind: 'markdown', key: 'markdown-1', content: '' },
    ]);
    const completed = splitOpenUiContent(source + '")])\n```\n\nAfter');
    expect(completed[1]).toEqual({
      kind: 'openui', key: 'openui-0', content: 'root = Stack([TextContent("partial")])', closed: true, offset: 8,
    });
    expect(completed[2]).toEqual({ kind: 'markdown', key: 'markdown-1', content: '\n\nAfter' });
  });

  it.each([
    '> ```openui\n> root = Stack([])\n> ```',
    '- Example\n\n  ```openui\n  root = Stack([])\n  ```',
    '````markdown\n```openui\nroot = Stack([])\n```\n````',
    '    ```openui\n    root = Stack([])\n    ```',
    '```typescript\nconst language = "openui"\n```',
    '```openui-example\nroot = Stack([])\n```',
    'An inline `openui` example.',
  ])('does not activate quoted or unrelated source: %s', (source) => {
    expect(splitOpenUiContent(source)).toEqual([{ kind: 'markdown', key: 'markdown-0', content: source }]);
  });

  it('preserves independent blocks and recognizes matching fences, including CRLF', () => {
    const parts = splitOpenUiContent('~~~openui-lang\r\nroot = Stack([])\r\n~~~\r\n\n````openui\nroot = Stack([])\n```');
    expect(parts.filter((part) => part.kind === 'openui')).toEqual([
      { kind: 'openui', key: 'openui-0', content: 'root = Stack([])', closed: true, offset: 0 },
      { kind: 'openui', key: 'openui-1', content: 'root = Stack([])\n```', closed: false, offset: 37 },
    ]);
  });
});
