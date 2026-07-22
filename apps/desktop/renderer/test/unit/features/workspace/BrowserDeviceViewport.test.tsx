import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BrowserDeviceViewport } from '../../../../src/features/workspace/BrowserDeviceViewport.js';
import {
  createDefaultBrowserDeviceEmulation,
  selectBrowserDeviceProfile,
} from '../../../../src/features/workspace/browserDeviceEmulation.js';

describe('BrowserDeviceViewport', () => {
  it('renders working edge and corner controls for responsive mode', () => {
    const html = renderToStaticMarkup(
      <BrowserDeviceViewport
        active
        deviceEmulation={{ ...createDefaultBrowserDeviceEmulation(), enabled: true }}
        onChange={vi.fn()}
      >
        <span>网页</span>
      </BrowserDeviceViewport>,
    );

    expect(html).toContain('class="desktop-browser-viewport is-active is-device-emulation is-responsive"');
    expect(html).toContain('aria-label="拖动左侧调整视口宽度"');
    expect(html).toContain('aria-label="拖动右侧调整视口宽度"');
    expect(html).toContain('aria-label="拖动底部调整视口高度"');
    expect(html).toContain('aria-label="拖动左下角调整视口尺寸"');
    expect(html).toContain('aria-label="拖动右下角调整视口尺寸"');
  });

  it('keeps named device presets fixed', () => {
    const deviceEmulation = selectBrowserDeviceProfile(
      { ...createDefaultBrowserDeviceEmulation(), enabled: true },
      'iphone-15-pro',
    );
    const html = renderToStaticMarkup(
      <BrowserDeviceViewport active deviceEmulation={deviceEmulation} onChange={vi.fn()}>
        <span>网页</span>
      </BrowserDeviceViewport>,
    );

    expect(html).not.toContain('desktop-browser-device-resize-handle');
  });
});
