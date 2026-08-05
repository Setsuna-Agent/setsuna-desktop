import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimePluginNavigationProvider } from '../../../../../src/features/chat/artifacts/RuntimePluginNavigation.js';
import { RuntimePluginUses } from '../../../../../src/features/chat/artifacts/RuntimePluginUses.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

describe('RuntimePluginUses', () => {
  it('announces active Plugin usage with an inline Plugin label', () => {
    const html = renderToStaticMarkup(
      <RuntimePluginUses
        active
        plugins={[{ id: 'documents', installed: true, name: 'Word 文档处理', icon: 'documents' }]}
      />,
    );

    expect(html).toContain('正在使用插件');
    expect(html).toContain('Word 文档处理');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('desktop-plugin-icon--inline');
    expect(html).toContain('data-plugin-icon="documents"');
  });

  it('keeps an uninstalled Plugin in history without showing a placeholder icon', () => {
    const html = renderToStaticMarkup(
      <RuntimePluginUses active={false} plugins={[{ id: 'documents', installed: false, name: 'Word 文档处理' }]} />,
    );

    expect(html).toContain('已使用插件');
    expect(html).toContain('Word 文档处理');
    expect(html).not.toContain('desktop-plugin-icon');
    expect(html).not.toContain('aria-live');
  });

  it('keeps an installed Plugin without icon metadata visually contiguous', () => {
    const html = renderToStaticMarkup(
      <RuntimePluginUses
        active={false}
        plugins={[{ id: 'context7-docs', installed: true, name: 'Context7 文档查询' }]}
      />,
    );

    expect(html).toContain('已使用插件');
    expect(html).toContain('Context7 文档查询');
    expect(html).not.toContain('desktop-plugin-icon');
    expect(html).not.toContain('data-plugin-icon="plugin"');
  });

  it('renders highlighted Plugin names as native buttons when navigation is available', () => {
    const html = renderToStaticMarkup(
      <RuntimePluginNavigationProvider onOpenPlugin={() => undefined}>
        <RuntimePluginUses
          active={false}
          plugins={[{ id: 'context7-docs', installed: true, name: 'Context7 文档查询' }]}
        />
      </RuntimePluginNavigationProvider>,
    );

    expect(html).toContain('<button class="chat-plugin-use" type="button"');
    expect(html).toContain('Context7 文档查询</span></button>');
  });

  it('announces Plugin usage in English', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en-US">
        <RuntimePluginUses active plugins={[{ id: 'documents', installed: true, name: 'Documents' }]} />
      </I18nProvider>,
    );

    expect(html).toContain('Using plugins');
    expect(html).toContain('title="Plugin: Documents"');
    expect(html).not.toContain('正在使用插件');
  });
});
