import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimePluginUses } from './RuntimePluginUses.js';

describe('RuntimePluginUses', () => {
  it('announces active Plugin usage with an inline Plugin label', () => {
    const html = renderToStaticMarkup(
      <RuntimePluginUses
        active
        plugins={[{ id: 'documents', name: 'Word 文档处理', icon: 'documents' }]}
      />,
    );

    expect(html).toContain('正在使用插件');
    expect(html).toContain('Word 文档处理');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('chat-plugin-use__icon');
  });

  it('uses completed wording for historical turns', () => {
    const html = renderToStaticMarkup(
      <RuntimePluginUses active={false} plugins={[{ id: 'documents', name: 'Word 文档处理' }]} />,
    );

    expect(html).toContain('已使用插件');
    expect(html).not.toContain('aria-live');
  });
});
