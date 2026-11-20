import type { DesktopBrowserDeviceUserAgentProfile } from './browser-control.js';

type BrowserDeviceProfile = {
  deviceScaleFactor: number;
  height?: number;
  id: string;
  label: string;
  mobile: boolean;
  userAgentProfile: DesktopBrowserDeviceUserAgentProfile;
  width?: number;
};

export const browserDeviceProfiles = [
  { deviceScaleFactor: 1, height: undefined, id: 'responsive', label: '响应式', mobile: false, userAgentProfile: 'desktop', width: undefined },
  { deviceScaleFactor: 1, height: 2160, id: '4k', label: '4K', mobile: false, userAgentProfile: 'desktop', width: 3840 },
  { deviceScaleFactor: 1, height: 900, id: 'laptop-l', label: 'Laptop L', mobile: false, userAgentProfile: 'desktop', width: 1440 },
  { deviceScaleFactor: 1, height: 768, id: 'laptop', label: '笔记本电脑', mobile: false, userAgentProfile: 'desktop', width: 1024 },
  { deviceScaleFactor: 2, height: 1368, id: 'surface-pro-7', label: 'Surface Pro 7', mobile: true, userAgentProfile: 'windows-desktop', width: 912 },
  { deviceScaleFactor: 2, height: 1180, id: 'ipad-air', label: 'iPad Air', mobile: true, userAgentProfile: 'ios-tablet', width: 820 },
  { deviceScaleFactor: 2, height: 1024, id: 'ipad-mini', label: 'iPad Mini', mobile: true, userAgentProfile: 'ios-tablet', width: 768 },
  { deviceScaleFactor: 2.5, height: 720, id: 'surface-duo', label: 'Surface Duo', mobile: true, userAgentProfile: 'android-phone', width: 540 },
  { deviceScaleFactor: 3, height: 932, id: 'iphone-15-pro-max', label: 'iPhone 15 Pro Max', mobile: true, userAgentProfile: 'ios-phone', width: 430 },
  { deviceScaleFactor: 2.625, height: 915, id: 'pixel-8', label: 'Pixel 8', mobile: true, userAgentProfile: 'android-phone', width: 412 },
  { deviceScaleFactor: 3, height: 852, id: 'iphone-15-pro', label: 'iPhone 15 Pro', mobile: true, userAgentProfile: 'ios-phone', width: 393 },
  { deviceScaleFactor: 3, height: 915, id: 'galaxy-s24-ultra', label: 'Samsung Galaxy S24 Ultra', mobile: true, userAgentProfile: 'android-phone', width: 412 },
  { deviceScaleFactor: 2, height: 667, id: 'iphone-se', label: 'iPhone SE', mobile: true, userAgentProfile: 'ios-phone', width: 375 },
] as const satisfies readonly BrowserDeviceProfile[];

export type BrowserDeviceProfileId = (typeof browserDeviceProfiles)[number]['id'];
