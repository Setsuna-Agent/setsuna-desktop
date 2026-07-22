import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimePluginUses } from '../../../../../src/features/chat/artifacts/RuntimePluginUses.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

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
    expect(html).toContain('desktop-plugin-icon--inline');
    expect(html).toContain('data-plugin-icon="documents"');
  });

  it('uses completed wording for historical turns', () => {
    const html = renderToStaticMarkup(
      <RuntimePluginUses active={false} plugins={[{ id: 'documents', name: 'Word 文档处理' }]} />,
    );

    expect(html).toContain('已使用插件');
    expect(html).toContain('data-plugin-icon="plugin"');
    expect(html).not.toContain('aria-live');
  });

  it('announces Plugin usage in English', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en-US">
        <RuntimePluginUses active plugins={[{ id: 'documents', name: 'Documents' }]} />
      </I18nProvider>,
    );

    expect(html).toContain('Using plugins');
    expect(html).toContain('title="Plugin: Documents"');
    expect(html).not.toContain('正在使用插件');
  });
});
