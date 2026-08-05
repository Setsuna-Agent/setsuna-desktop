import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellFrame } from '../../../../src/app/layout/ShellFrame.js';
import { appRouteTopbarSlotId } from '../../../../src/shared/ui/AppRouteTopbarPortal.js';

describe('ShellFrame route topbar slot', () => {
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
});
