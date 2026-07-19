import { describe, expect, it } from 'vitest';
import {
  createStartupSplashPageUrl,
  decodeStartupSplashPageUrl,
  STARTUP_SPLASH_SHIMMER_DURATION_MS,
} from './startup-splash-page.js';

describe('startup splash page', () => {
  it('renders a centered logo with a five-second shimmer and reduced-motion fallback', () => {
    const logo = 'data:image/png;base64,aGVsbG8=';
    const html = decodeStartupSplashPageUrl(createStartupSplashPageUrl(logo));

    expect(STARTUP_SPLASH_SHIMMER_DURATION_MS).toBe(5_000);
    expect(html).toContain('place-items: center');
    expect(html).toContain('background: #f7f6fa');
    expect(html).not.toContain('radial-gradient');
    expect(html).toContain('animation: setsuna-logo-shimmer 5s');
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
    expect(html.match(/src="data:image\/png;base64,aGVsbG8="/g)).toHaveLength(2);
    expect(html).not.toContain('<script');
  });

  it('falls back to an embedded image when the supplied logo is not a safe image data URL', () => {
    const html = decodeStartupSplashPageUrl(createStartupSplashPageUrl('javascript:alert(1)'));

    expect(html).not.toContain('javascript:');
    expect(html).toContain('data:image/svg+xml;base64,');
  });
});
