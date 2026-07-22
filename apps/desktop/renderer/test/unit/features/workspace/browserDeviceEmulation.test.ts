import { describe, expect, it } from 'vitest';
import {
  browserDeviceViewportSize,
  createDefaultBrowserDeviceEmulation,
  dragResizeBrowserDevice,
  resizeBrowserDevice,
  rotateBrowserDevice,
  selectBrowserDeviceProfile,
  toDesktopBrowserDeviceEmulation,
} from '../../../../src/features/workspace/browserDeviceEmulation.js';

describe('browser device emulation', () => {
  it('keeps emulation disabled until the toolbar is opened', () => {
    const state = createDefaultBrowserDeviceEmulation();

    expect(toDesktopBrowserDeviceEmulation(state)).toBeNull();
    expect(browserDeviceViewportSize(state)).toBeNull();
  });

  it('applies device metrics and rotates the selected profile', () => {
    const selected = selectBrowserDeviceProfile(
      { ...createDefaultBrowserDeviceEmulation(), enabled: true },
      'iphone-15-pro',
    );

    expect(selected).toMatchObject({
      deviceScaleFactor: 3,
      height: 852,
      mobile: true,
      profileId: 'iphone-15-pro',
      userAgentProfile: 'ios-phone',
      width: 393,
    });
    expect(rotateBrowserDevice(selected)).toMatchObject({ height: 393, width: 852 });
  });

  it('switches custom dimensions back to responsive mode and scales the viewport', () => {
    const selected = selectBrowserDeviceProfile(
      { ...createDefaultBrowserDeviceEmulation(), enabled: true, scale: 0.5 },
      'pixel-8',
    );
    const resized = resizeBrowserDevice(selected, 'width', 640);

    expect(resized).toMatchObject({
      deviceScaleFactor: 1,
      mobile: false,
      profileId: 'responsive',
      userAgentProfile: 'desktop',
      width: 640,
    });
    expect(browserDeviceViewportSize(resized)).toEqual({ height: 458, width: 320 });
    expect(toDesktopBrowserDeviceEmulation(resized)).toMatchObject({ height: 915, scale: 0.5, width: 640 });
  });

  it('converts edge and corner drags into logical responsive dimensions', () => {
    const state = {
      ...createDefaultBrowserDeviceEmulation(),
      enabled: true,
      height: 800,
      scale: 0.5,
      width: 400,
    };

    expect(dragResizeBrowserDevice(state, 'right', 25, 0)).toMatchObject({ height: 800, width: 500 });
    expect(dragResizeBrowserDevice(state, 'left', 25, 0)).toMatchObject({ height: 800, width: 300 });
    expect(dragResizeBrowserDevice(state, 'bottom', 0, 25)).toMatchObject({ height: 850, width: 400 });
    expect(dragResizeBrowserDevice(state, 'bottom-right', 25, 25)).toMatchObject({ height: 850, width: 500 });
  });

  it('selects the UA family that matches each named device', () => {
    const state = { ...createDefaultBrowserDeviceEmulation(), enabled: true };

    expect(selectBrowserDeviceProfile(state, 'ipad-air').userAgentProfile).toBe('ios-tablet');
    expect(selectBrowserDeviceProfile(state, 'pixel-8').userAgentProfile).toBe('android-phone');
    expect(selectBrowserDeviceProfile(state, 'surface-pro-7').userAgentProfile).toBe('windows-desktop');
    expect(selectBrowserDeviceProfile(state, 'laptop-l').userAgentProfile).toBe('desktop');
  });
});
