import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KeyboardShortcutsSettings } from '../../../../src/features/settings/shortcuts/KeyboardShortcutsSettings.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { KeyboardShortcutsProvider } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';

describe('KeyboardShortcutsSettings', () => {
  it('renders configured shortcuts with edit, remove, and add controls', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en-US">
        <KeyboardShortcutsProvider initialPlatform="win32">
          <KeyboardShortcutsSettings />
        </KeyboardShortcutsProvider>
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="Search shortcuts"');
    expect(html).toContain('<kbd>Ctrl+N</kbd>');
    expect(html).toContain('class="settings-shortcuts__binding-key"');
    expect(html).toContain('class="settings-shortcuts__binding-remove"');
    expect(html).toContain('class="settings-shortcuts__add"');
  });
});
