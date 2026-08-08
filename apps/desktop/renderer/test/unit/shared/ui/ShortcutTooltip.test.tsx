import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KeyboardShortcutsProvider } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';
import { ShortcutTooltipContent } from '../../../../src/shared/ui/ShortcutTooltip.js';

describe('ShortcutTooltipContent', () => {
  it('renders current Windows and macOS bindings with platform-appropriate markup', () => {
    const windowsHtml = renderToStaticMarkup(
      <KeyboardShortcutsProvider initialPlatform="win32">
        <ShortcutTooltipContent commandId="layout.toggleSidebar" label="Toggle sidebar" />
      </KeyboardShortcutsProvider>,
    );
    const macHtml = renderToStaticMarkup(
      <KeyboardShortcutsProvider initialPlatform="darwin">
        <ShortcutTooltipContent commandId="app.toggleRuntimeActivity" label="Open runtime activity" />
      </KeyboardShortcutsProvider>,
    );

    expect(windowsHtml).toContain('<kbd>Ctrl+B</kbd>');
    expect(macHtml).toContain('<kbd class="is-mac"><span>⇧</span><span>⌘</span><span>A</span></kbd>');
  });
});
