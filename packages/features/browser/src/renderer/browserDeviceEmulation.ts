import { browserDeviceProfiles, type BrowserDeviceProfileId, type DesktopBrowserDeviceEmulation } from '../contracts/index.js';
export { browserDeviceProfiles, type BrowserDeviceProfileId } from '../contracts/index.js';

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
