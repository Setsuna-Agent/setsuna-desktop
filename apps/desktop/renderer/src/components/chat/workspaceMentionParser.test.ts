import { describe, expect, it } from 'vitest';
import { parseWorkspaceMentionText } from './workspaceMentionParser.js';

describe('workspace mention message text', () => {
  it('projects serialized file and directory mentions without losing surrounding whitespace', () => {
    const content = '请看 @src/components/Tile.tsx 和\n@src/';

    expect(parseWorkspaceMentionText(content)).toEqual([
      { start: 0, type: 'text', value: '请看 ' },
      {
        entryType: 'file',
        path: 'src/components/Tile.tsx',
        serializedText: '@src/components/Tile.tsx',
        start: 3,
        type: 'mention',
      },
      { start: 27, type: 'text', value: ' 和\n' },
      {
        entryType: 'directory',
        path: 'src/',
        serializedText: '@src/',
        start: 30,
        type: 'mention',
      },
    ]);
  });

  it('does not treat email addresses or an isolated marker as workspace mentions', () => {
    const content = '联系 dev@example.com 或输入 @';

    expect(parseWorkspaceMentionText(content)).toEqual([
      { start: 0, type: 'text', value: content },
    ]);
  });
});
