import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { BrowserDebuggerTransport } from '../../../../src/browser/cdp/automation.js';
import {
  ElectronBrowserCdpDeviceEmulator,
  resolveBrowserUserAgentOverride,
} from '../../../../src/browser/cdp/device-emulation.js';

class FakeDebuggerTransport extends EventEmitter implements BrowserDebuggerTransport {
  attached = false;
  readonly commands: Array<{ method: string; params?: unknown }> = [];
  detachCount = 0;

  attach(): void {
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.detachCount += 1;
    this.emit('detach');
  }

  isAttached(): boolean {
    return this.attached;
  }

  async sendCommand(method: string, params?: unknown): Promise<unknown> {
    this.commands.push({ method, params });
    return {};
  }
}

describe('resolveBrowserUserAgentOverride', () => {
  const desktopUserAgent = 'Mozilla/5.0 Chrome/140.0.7339.0 Safari/537.36 Electron/43.1.0';

  it('uses Safari-style iOS identities without desktop Chromium client hints', () => {
    expect(resolveBrowserUserAgentOverride('ios-phone', desktopUserAgent)).toEqual({
      platform: 'iPhone',
      userAgent: expect.stringContaining('iPhone'),
    });
    expect(resolveBrowserUserAgentOverride('ios-tablet', desktopUserAgent)).toEqual({
      platform: 'iPad',
      userAgent: expect.stringContaining('iPad'),
    });
  });

  it('marks Android client hints as mobile and Windows hints as desktop', () => {
    expect(resolveBrowserUserAgentOverride('android-phone', desktopUserAgent)).toMatchObject({
      platform: 'Linux armv8l',
      userAgent: expect.stringContaining('Mobile Safari'),
      userAgentMetadata: { mobile: true, platform: 'Android' },
    });
    expect(resolveBrowserUserAgentOverride('windows-desktop', desktopUserAgent)).toMatchObject({
      platform: 'Win32',
      userAgentMetadata: { mobile: false, platform: 'Windows' },
    });
    expect(resolveBrowserUserAgentOverride('desktop', desktopUserAgent)).toBeNull();
  });
});

describe('ElectronBrowserCdpDeviceEmulator', () => {
  it('applies and clears UA metadata and touch emulation through one owned CDP session', async () => {
    const transport = new FakeDebuggerTransport();
    const emulator = new ElectronBrowserCdpDeviceEmulator(transport);
    const userAgent = resolveBrowserUserAgentOverride('android-phone', 'Chrome/140.0.7339.0')!;

    await emulator.apply({ touch: true, userAgent });
    expect(transport.attached).toBe(true);
    expect(transport.commands).toEqual([
      { method: 'Emulation.setUserAgentOverride', params: userAgent },
      { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 5 } },
    ]);

    await emulator.apply({ touch: true, userAgent });
    expect(transport.commands).toHaveLength(2);

    await emulator.apply(null);
    expect(transport.commands.slice(-2)).toEqual([
      { method: 'Emulation.setUserAgentOverride', params: { userAgent: '' } },
      { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: false, maxTouchPoints: 1 } },
    ]);

    emulator.dispose();
    expect(transport.detachCount).toBe(1);
  });

  it('does not attach only to clear an untouched desktop tab', async () => {
    const transport = new FakeDebuggerTransport();
    const emulator = new ElectronBrowserCdpDeviceEmulator(transport);

    await emulator.apply(null);

    expect(transport.attached).toBe(false);
    expect(transport.commands).toEqual([]);
  });

  it('does not lose a clear requested while a mobile override is still pending', async () => {
    const transport = new FakeDebuggerTransport();
    const emulator = new ElectronBrowserCdpDeviceEmulator(transport);
    const userAgent = resolveBrowserUserAgentOverride('ios-phone', 'Chrome/140.0.7339.0')!;

    const enable = emulator.apply({ touch: true, userAgent });
    const clear = emulator.apply(null);
    await Promise.all([enable, clear]);

    expect(transport.commands.slice(-2)).toEqual([
      { method: 'Emulation.setUserAgentOverride', params: { userAgent: '' } },
      { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: false, maxTouchPoints: 1 } },
    ]);
  });
});
