export function applyDesktopPlatformAttribute(root: HTMLElement = document.documentElement) {
  root.dataset.desktopPlatform = getDesktopPlatform();
}

export function usesCustomFrameLayout(): boolean {
  const platform = getDesktopPlatform();
  return platform === 'win32' || platform === 'linux';
}

export function getDesktopPlatform(): string {
  const bridgePlatform = window.setsunaDesktop?.desktop.platform;
  if (bridgePlatform) return bridgePlatform;

  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'win32';
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('linux')) return 'linux';
  return 'browser';
}
