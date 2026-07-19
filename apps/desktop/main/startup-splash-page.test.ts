import { describe, expect, it } from 'vitest';
import {
  createStartupSplashPageUrl,
  createStartupSplashWindowActionUrl,
  decodeStartupSplashPageUrl,
  STARTUP_SPLASH_SHIMMER_DURATION_MS,
  startupSplashWindowActionFromUrl,
} from './startup-splash-page.js';

describe('startup splash page', () => {
  it('renders a centered logo with a refined five-second left-to-right shimmer', () => {
    const logo = 'data:image/png;base64,aGVsbG8=';
    const html = decodeStartupSplashPageUrl(createStartupSplashPageUrl(logo));

    expect(STARTUP_SPLASH_SHIMMER_DURATION_MS).toBe(5_000);
    expect(html).toContain('place-items: center');
    expect(html).toContain('background: #f7f6fa');
    expect(html).not.toContain('radial-gradient');
    expect(html).toContain('class="startup-splash-running"');
    expect(html).toContain('animation: setsuna-logo-shimmer 5s linear infinite');
    expect(html).toMatch(
      /@keyframes setsuna-logo-shimmer[\s\S]*?0%\s*\{[\s\S]*?-webkit-mask-position: -90% 0[\s\S]*?25%\s*\{[\s\S]*?-webkit-mask-position: 190% 0/,
    );
    expect(html).toContain('-webkit-mask-size: 36% 100%');
    expect(html).toContain('filter: grayscale(1) contrast(0.72) brightness(2.25)');
    expect(html).not.toContain('box-shadow');
    expect(html).not.toContain('mix-blend-mode: screen');
    expect(html).not.toContain('prefers-reduced-motion');
    expect(html.match(/src="data:image\/png;base64,aGVsbG8="/g)).toHaveLength(2);
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
