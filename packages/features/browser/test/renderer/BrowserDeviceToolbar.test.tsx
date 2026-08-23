import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrowserDeviceToolbar } from '../../src/renderer/BrowserDeviceToolbar.js';
import { BrowserDeviceViewport } from '../../src/renderer/BrowserDeviceViewport.js';
import {
  createDefaultBrowserDeviceEmulation,
  selectBrowserDeviceProfile,
} from '../../src/renderer/browserDeviceEmulation.js';
import { translateBrowserMessage } from '../../src/renderer/messages.js';

const translate = (key: Parameters<typeof translateBrowserMessage>[1]) => (
  translateBrowserMessage('zh-CN', key)
);

describe('browser device controls', () => {
  it('renders responsive controls while keeping named device presets fixed', () => {
    const responsive = { ...createDefaultBrowserDeviceEmulation(), enabled: true };
    const toolbarHtml = renderToStaticMarkup(
      <BrowserDeviceToolbar translate={translate} value={responsive} onChange={() => undefined} />,
    );
    const responsiveHtml = renderToStaticMarkup(
      <BrowserDeviceViewport active deviceEmulation={responsive} translate={translate} onChange={() => undefined}>
        <span>page</span>
      </BrowserDeviceViewport>,
    );
    const fixedHtml = renderToStaticMarkup(
      <BrowserDeviceViewport
        active
        deviceEmulation={selectBrowserDeviceProfile(responsive, 'iphone-15-pro')}
        translate={translate}
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
    for (const label of [
      '拖动左侧调整视口宽度',
      '拖动右侧调整视口宽度',
      '拖动底部调整视口高度',
      '拖动左下角调整视口尺寸',
      '拖动右下角调整视口尺寸',
    ]) {
      expect(responsiveHtml).toContain(`aria-label="${label}"`);
    }
    expect(fixedHtml).not.toContain('desktop-browser-device-resize-handle');
  });
});
