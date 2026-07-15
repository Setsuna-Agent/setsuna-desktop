import type { DesktopBrowserDeviceUserAgentProfile } from '@setsuna-desktop/contracts';
import type { BrowserDebuggerTransport } from './browser-cdp-automation.js';

type BrowserUserAgentBrandVersion = {
  brand: string;
  version: string;
};

type BrowserUserAgentMetadata = {
  architecture: string;
  bitness: string;
  brands: BrowserUserAgentBrandVersion[];
  fullVersionList: BrowserUserAgentBrandVersion[];
  mobile: boolean;
  model: string;
  platform: string;
  platformVersion: string;
};

export type BrowserUserAgentOverride = {
  platform: string;
  userAgent: string;
  userAgentMetadata?: BrowserUserAgentMetadata;
};

export type BrowserDeviceCdpOverrides = {
  touch: boolean;
  userAgent: BrowserUserAgentOverride | null;
};

export type BrowserDeviceEmulator = {
  apply(overrides: BrowserDeviceCdpOverrides | null): Promise<void>;
  dispose(): void;
};

const protocolVersion = '1.3';

/** Applies the parts of Chrome device mode that Electron's native metrics API omits. */
export class ElectronBrowserCdpDeviceEmulator implements BrowserDeviceEmulator {
  private appliedKey: string | null = null;
  private attachedByThisInstance = false;
  private disposed = false;
  private operation: Promise<void> = Promise.resolve();
  private overrideRequested = false;

  private readonly handleDetach = (): void => {
    this.appliedKey = null;
    this.attachedByThisInstance = false;
    this.overrideRequested = false;
  };

  constructor(private readonly transport: BrowserDebuggerTransport) {
    transport.on('detach', this.handleDetach);
  }

  apply(overrides: BrowserDeviceCdpOverrides | null): Promise<void> {
    // A fresh desktop tab has no CDP override to clear, so avoid attaching a
    // debugger until device mode actually needs protocol-only capabilities.
    if (overrides === null && !this.overrideRequested && this.appliedKey === null) return this.operation;
    this.overrideRequested = overrides !== null;
    const key = overrides === null ? null : JSON.stringify(overrides);
    const operation = this.operation.then(async () => {
      if (this.disposed || (key === this.appliedKey && this.transport.isAttached())) return;
      this.ensureAttached();
      await this.transport.sendCommand(
        'Emulation.setUserAgentOverride',
        overrides?.userAgent ?? { userAgent: '' },
      );
      await this.transport.sendCommand('Emulation.setTouchEmulationEnabled', {
        enabled: overrides?.touch ?? false,
        maxTouchPoints: overrides?.touch ? 5 : 1,
      });
      this.appliedKey = key;
    });
    // Keep later updates usable after a transient protocol failure while still
    // returning the original rejection to the caller that requested this update.
    this.operation = operation.catch(() => undefined);
    return operation;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transport.off('detach', this.handleDetach);
    if (this.attachedByThisInstance && this.transport.isAttached()) this.transport.detach();
    this.attachedByThisInstance = false;
    this.appliedKey = null;
    this.overrideRequested = false;
  }

  private ensureAttached(): void {
    if (this.transport.isAttached()) return;
    this.transport.attach(protocolVersion);
    this.attachedByThisInstance = true;
  }
}

export function resolveBrowserUserAgentOverride(
  profile: DesktopBrowserDeviceUserAgentProfile,
  defaultUserAgent: string,
): BrowserUserAgentOverride | null {
  if (profile === 'desktop') return null;
  if (profile === 'ios-phone') {
    return {
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    };
  }
  if (profile === 'ios-tablet') {
    return {
      platform: 'iPad',
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    };
  }

  const chromeVersion = /Chrome\/([\d.]+)/.exec(defaultUserAgent)?.[1] ?? process.versions.chrome ?? '131.0.0.0';
  const chromeMajorVersion = chromeVersion.split('.')[0] ?? chromeVersion;
  const brands = chromiumBrands(chromeMajorVersion, chromeVersion);
  if (profile === 'windows-desktop') {
    return {
      platform: 'Win32',
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
      userAgentMetadata: {
        architecture: 'x86',
        bitness: '64',
        ...brands,
        mobile: false,
        model: '',
        platform: 'Windows',
        platformVersion: '10.0.0',
      },
    };
  }
  return {
    platform: 'Linux armv8l',
    userAgent: `Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`,
    userAgentMetadata: {
      architecture: 'arm',
      bitness: '64',
      ...brands,
      mobile: true,
      model: 'K',
      platform: 'Android',
      platformVersion: '15.0.0',
    },
  };
}

function chromiumBrands(majorVersion: string, fullVersion: string): Pick<BrowserUserAgentMetadata, 'brands' | 'fullVersionList'> {
  return {
    brands: [
      { brand: 'Not_A Brand', version: '99' },
      { brand: 'Chromium', version: majorVersion },
    ],
    fullVersionList: [
      { brand: 'Not_A Brand', version: '99.0.0.0' },
      { brand: 'Chromium', version: fullVersion },
    ],
  };
}
