import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrowserDeviceToolbar } from '../../../../src/features/workspace/BrowserDeviceToolbar.js';
import { BrowserDeviceViewport } from '../../../../src/features/workspace/BrowserDeviceViewport.js';
import {
  createDefaultBrowserDeviceEmulation,
  selectBrowserDeviceProfile,
} from '../../../../src/features/workspace/browserDeviceEmulation.js';

describe('browser device controls', () => {
  it('renders responsive controls while keeping named device presets fixed', () => {
    const responsive = { ...createDefaultBrowserDeviceEmulation(), enabled: true };
    const toolbarHtml = renderToStaticMarkup(
      <BrowserDeviceToolbar value={responsive} onChange={() => undefined} />,
    );
    const responsiveHtml = renderToStaticMarkup(
      <BrowserDeviceViewport active deviceEmulation={responsive} onChange={() => undefined}>
        <span>page</span>
      </BrowserDeviceViewport>,
    );
    const fixedHtml = renderToStaticMarkup(
      <BrowserDeviceViewport
        active
        deviceEmulation={selectBrowserDeviceProfile(responsive, 'iphone-15-pro')}
        onChange={() => undefined}
      >
        <span>page</span>
      </BrowserDeviceViewport>,
    );

    expect(toolbarHtml).toContain('desktop-browser-device-toolbar__profile');
    expect(toolbarHtml).toContain('desktop-browser-device-toolbar__dimensions');
    expect(toolbarHtml).toContain('desktop-browser-device-toolbar__rotate');
    expect(toolbarHtml).toContain('desktop-browser-device-toolbar__scale');
    expect(responsiveHtml.match(/desktop-browser-device-resize-handle--/gu)).toHaveLength(5);
    expect(fixedHtml).not.toContain('desktop-browser-device-resize-handle');
  });
});
