import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BrowserDeviceToolbar } from '../../../../src/features/workspace/BrowserDeviceToolbar.js';
import { createDefaultBrowserDeviceEmulation } from '../../../../src/features/workspace/browserDeviceEmulation.js';

describe('BrowserDeviceToolbar', () => {
  it('renders device presets, viewport dimensions, rotation, and scale controls', () => {
    const html = renderToStaticMarkup(
      <BrowserDeviceToolbar
        value={{ ...createDefaultBrowserDeviceEmulation(), enabled: true }}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="设备工具栏"');
    expect(html).toContain('aria-label="设备预设"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('sd-select-field');
    expect(html).toContain('aria-label="视口宽度"');
    expect(html).toContain('aria-label="视口高度"');
    expect(html).toContain('aria-label="旋转设备"');
    expect(html).toContain('aria-label="设备缩放"');
    expect(html).not.toContain('<select');
  });
});
