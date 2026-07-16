import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceMentionText } from './WorkspaceMentionText.js';
import { MarkdownNavigationProvider } from './markdown/MarkdownNavigationProvider.js';

describe('WorkspaceMentionText', () => {
  it('renders sent workspace mentions with the shared icon and visual label', () => {
    const html = renderToStaticMarkup(
      <MarkdownNavigationProvider onOpenWorkspaceFile={() => undefined}>
        <WorkspaceMentionText content="@tsconfig.renderer.json 这个文件是干啥的" />
      </MarkdownNavigationProvider>,
    );

    expect(html).toContain('class="chat-workspace-mention chat-workspace-mention--action"');
    expect(html).toContain('type="button"');
    expect(html).toContain('使用默认打开方式打开 tsconfig.renderer.json');
    expect(html).toContain('data-file-icon-theme="seti"');
    expect(html).toContain('>tsconfig.renderer.json</span>');
    expect(html).toContain(' 这个文件是干啥的');
    expect(html).not.toContain('>@tsconfig.renderer.json</span>');
    expect(html).not.toContain('data-composer-cursor-offset-adjustment');
  });
});
