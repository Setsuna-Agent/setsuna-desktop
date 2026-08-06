import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KeyboardShortcutsProvider } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';
import { ShortcutTooltipContent } from '../../../../src/shared/ui/ShortcutTooltip.js';

describe('ShortcutTooltipContent', () => {
  it.each([
    ['darwin', '⌘B'],
    ['win32', 'Ctrl+B'],
  ] as const)('renders the current %s binding beside the action label', (platform, binding) => {
    const html = renderToStaticMarkup(
      <KeyboardShortcutsProvider initialPlatform={platform}>
        <ShortcutTooltipContent commandId="layout.toggleSidebar" label="显示/隐藏侧边栏" />
      </KeyboardShortcutsProvider>,
    );

    expect(html).toContain('显示/隐藏侧边栏');
    expect(html).toContain(`<kbd>${binding}</kbd>`);
  });
});
