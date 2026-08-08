import { describe, expect, it } from 'vitest';
import {
  createStartupSplashPageUrl,
  createStartupSplashWindowActionUrl,
  startupSplashWindowActionFromUrl,
} from '../../../../src/window/splash/page.js';
import { decodeStartupSplashPageUrl } from '../../../support/startup-splash-page.js';

describe('startup splash page', () => {
  it('renders a script-free data page with the supplied safe logo', () => {
    const logo = 'data:image/png;base64,aGVsbG8=';
    const pageUrl = createStartupSplashPageUrl(logo);
    const html = decodeStartupSplashPageUrl(pageUrl);

    expect(pageUrl).toMatch(/^data:text\/html;base64,/);
    expect(html).toContain("default-src 'none'; img-src data:; style-src 'unsafe-inline';");
    expect(html).toContain(`src="${logo}"`);
    expect(html).not.toContain('<script');
  });

  it('renders safe frameless window controls with parseable actions', () => {
    const html = decodeStartupSplashPageUrl(createStartupSplashPageUrl(undefined, { windowControls: true }));

    expect(html).toContain('startup-window-controls');
    for (const action of ['minimize', 'toggle-maximize', 'close'] as const) {
      const actionUrl = createStartupSplashWindowActionUrl(action);
      expect(html).toContain(`href="${actionUrl}"`);
      expect(startupSplashWindowActionFromUrl(actionUrl)).toBe(action);
    }
    expect(startupSplashWindowActionFromUrl('https://example.com')).toBeNull();
    expect(startupSplashWindowActionFromUrl('setsuna-startup-action://close/extra')).toBeNull();
  });

  it('falls back to an embedded image when the supplied logo is not a safe image data URL', () => {
    const html = decodeStartupSplashPageUrl(createStartupSplashPageUrl('javascript:alert(1)'));

    expect(html).not.toContain('javascript:');
    expect(html).toContain('data:image/svg+xml;base64,');
  });
});
