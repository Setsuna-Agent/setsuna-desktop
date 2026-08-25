import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellFrame } from '../../../../src/app/layout/ShellFrame.js';
import { appRouteTopbarSlotId } from '../../../../src/shared/ui/AppRouteTopbarPortal.js';

describe('ShellFrame', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['linux', 'win32'])('places route controls inside the %s titlebar drag track', (platform) => {
    vi.stubGlobal('window', {
      setsunaDesktop: { desktop: { platform } },
    });

    const html = renderToStaticMarkup(<ShellFrame />);
    const dragTrackIndex = html.indexOf('app-topbar__drag');
    const routeSlotIndex = html.indexOf(`id="${appRouteTopbarSlotId}"`);

    expect(dragTrackIndex).toBeGreaterThan(-1);
    expect(routeSlotIndex).toBeGreaterThan(dragTrackIndex);
    expect(html).not.toContain('app-topbar__drag" aria-hidden');
  });

  it('places feature navigation actions beside the sidebar control', () => {
    vi.stubGlobal('window', {
      setsunaDesktop: { desktop: { platform: 'darwin' } },
    });

    const html = renderToStaticMarkup(
      <ShellFrame
        menuActions={{ onNewChat: vi.fn() }}
        navigationActions={<button type="button">Activity center</button>}
        onToggleSidebar={vi.fn()}
      />,
    );
    const sidebarControlIndex = html.indexOf('aria-label="收起侧栏"');
    const activityIndex = html.indexOf('Activity center');
    const newChatIndex = html.indexOf('aria-label="新对话"');

    expect(sidebarControlIndex).toBeGreaterThan(-1);
    expect(activityIndex).toBeGreaterThan(sidebarControlIndex);
    expect(newChatIndex).toBeGreaterThan(activityIndex);
  });

});
