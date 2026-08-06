import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KeyboardShortcutsSettings } from '../../../../src/features/settings/shortcuts/KeyboardShortcutsSettings.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { keyboardShortcutCommands } from '../../../../src/shared/shortcuts/keyboardShortcutCommands.js';
import { KeyboardShortcutsProvider } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';

describe('KeyboardShortcutsSettings', () => {
  it('shows macOS defaults, descriptions, edit/remove controls and add controls', () => {
    const html = renderSettings('darwin', 'zh-CN');

    expect(html).toContain('新建对话');
    expect(html).toContain('在当前项目或全局上下文中新建一个空对话。');
    expect(html).toContain('<kbd>⌘N</kbd>');
    expect(html).toContain('<kbd>⌃`</kbd>');
    expect(html).toContain('aria-label="修改快捷键 ⌘N"');
    expect(html).toContain('aria-label="删除快捷键 ⌘N"');
    expect(html).toContain('aria-label="添加快捷键"');
    expect(html).not.toContain('<span>添加快捷键</span>');
    const resetButtons = html.match(/<button class="settings-shortcuts__reset"[^>]*>/g) ?? [];
    expect(resetButtons).toHaveLength(keyboardShortcutCommands.length);
    expect(resetButtons.every((button) => button.includes('disabled=""'))).toBe(true);
  });

  it('uses Windows labels and English copy when requested', () => {
    const html = renderSettings('win32', 'en-US');

    expect(html).toContain('Search shortcuts');
    expect(html).toContain('New chat');
    expect(html).toContain('<kbd>Ctrl+N</kbd>');
    expect(html).toContain('<kbd>Ctrl+Shift+B</kbd>');
    expect(html).not.toContain('<kbd>⌘N</kbd>');
  });
});

function renderSettings(
  platform: 'darwin' | 'win32',
  locale: 'zh-CN' | 'en-US',
): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <KeyboardShortcutsProvider initialPlatform={platform}>
        <KeyboardShortcutsSettings />
      </KeyboardShortcutsProvider>
    </I18nProvider>,
  );
}
