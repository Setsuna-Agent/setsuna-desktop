import type {
  DesktopBrowserDeviceEmulation,
  DesktopBrowserDeviceUserAgentProfile,
} from '@setsuna-desktop/contracts';

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

export type BrowserDeviceEmulationState = DesktopBrowserDeviceEmulation & {
  enabled: boolean;
  profileId: BrowserDeviceProfileId;
};

export type BrowserDeviceResizeHandle = 'bottom' | 'bottom-left' | 'bottom-right' | 'left' | 'right';

export function createDefaultBrowserDeviceEmulation(): BrowserDeviceEmulationState {
  return {
    deviceScaleFactor: 1,
    enabled: false,
    height: 844,
    mobile: false,
    profileId: 'responsive',
    scale: 1,
    userAgentProfile: 'desktop',
    width: 390,
  };
}

export function selectBrowserDeviceProfile(
  current: BrowserDeviceEmulationState,
  profileId: BrowserDeviceProfileId,
): BrowserDeviceEmulationState {
  const profile = browserDeviceProfiles.find((item) => item.id === profileId) ?? browserDeviceProfiles[0];
  return {
    ...current,
    deviceScaleFactor: profile.deviceScaleFactor,
    height: profile.height ?? current.height,
    mobile: profile.mobile,
    profileId: profile.id,
    userAgentProfile: profile.userAgentProfile,
    width: profile.width ?? current.width,
  };
}

export function resizeBrowserDevice(
  current: BrowserDeviceEmulationState,
  dimension: 'height' | 'width',
  value: number,
): BrowserDeviceEmulationState {
  return resizeBrowserDeviceViewport(current, { [dimension]: value });
}

export function resizeBrowserDeviceViewport(
  current: BrowserDeviceEmulationState,
  dimensions: Partial<Pick<BrowserDeviceEmulationState, 'height' | 'width'>>,
): BrowserDeviceEmulationState {
  return {
    ...current,
    deviceScaleFactor: 1,
    height: normalizeBrowserDeviceDimension(dimensions.height, current.height),
    mobile: false,
    profileId: 'responsive',
    userAgentProfile: 'desktop',
    width: normalizeBrowserDeviceDimension(dimensions.width, current.width),
  };
}

export function dragResizeBrowserDevice(
  current: BrowserDeviceEmulationState,
  handle: BrowserDeviceResizeHandle,
  deltaX: number,
  deltaY: number,
): BrowserDeviceEmulationState {
  const horizontalDelta = deltaX / current.scale;
  const verticalDelta = deltaY / current.scale;
  const changesWidth = handle !== 'bottom';
  const changesHeight = handle.startsWith('bottom');
  const widthDirection = handle.endsWith('left') || handle === 'left' ? -1 : 1;
  return resizeBrowserDeviceViewport(current, {
    height: changesHeight ? current.height + verticalDelta : current.height,
    // 响应式视口始终居中，因此左右边缘各移动逻辑宽度变化量的一半。
    width: changesWidth ? current.width + horizontalDelta * widthDirection * 2 : current.width,
  });
}

export function rotateBrowserDevice(current: BrowserDeviceEmulationState): BrowserDeviceEmulationState {
  return { ...current, height: current.width, width: current.height };
}

export function browserDeviceViewportSize(current: BrowserDeviceEmulationState): { height: number; width: number } | null {
  if (!current.enabled) return null;
  return {
    height: Math.round(current.height * current.scale),
    width: Math.round(current.width * current.scale),
  };
}

export function toDesktopBrowserDeviceEmulation(current: BrowserDeviceEmulationState): DesktopBrowserDeviceEmulation | null {
  if (!current.enabled) return null;
  const { deviceScaleFactor, height, mobile, scale, userAgentProfile, width } = current;
  return { deviceScaleFactor, height, mobile, scale, userAgentProfile, width };
}

function clampBrowserDeviceDimension(value: number): number {
  return Math.min(5_120, Math.max(240, Math.round(value)));
}

function normalizeBrowserDeviceDimension(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? clampBrowserDeviceDimension(value) : fallback;
}
