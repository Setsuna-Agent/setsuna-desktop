import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KeyboardShortcutsProvider } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';
import { ShortcutTooltipContent } from '../../../../src/shared/ui/ShortcutTooltip.js';

describe('ShortcutTooltipContent', () => {
  it.each([
    ['darwin', '<kbd class="is-mac"><span>⌘</span><span>B</span></kbd>'],
    ['win32', '<kbd>Ctrl+B</kbd>'],
  ] as const)('renders the current %s binding beside the action label', (platform, bindingMarkup) => {
    const html = renderToStaticMarkup(
      <KeyboardShortcutsProvider initialPlatform={platform}>
        <ShortcutTooltipContent commandId="layout.toggleSidebar" label="显示/隐藏侧边栏" />
      </KeyboardShortcutsProvider>,
    );

    expect(html).toContain('显示/隐藏侧边栏');
    expect(html).toContain(bindingMarkup);
  });

  it('separates each macOS modifier from the key label', () => {
    const html = renderToStaticMarkup(
      <KeyboardShortcutsProvider initialPlatform="darwin">
        <ShortcutTooltipContent commandId="app.toggleRuntimeActivity" label="打开运行中心" />
      </KeyboardShortcutsProvider>,
    );

    expect(html).toContain('<kbd class="is-mac"><span>⇧</span><span>⌘</span><span>A</span></kbd>');
  });
});
