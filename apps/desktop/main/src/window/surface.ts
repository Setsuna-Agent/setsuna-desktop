export interface MainWindowSurfaceOptions {
  transparent: boolean;
  backgroundColor: string;
}

const windowsMainWindowBackgroundColor = '#f7f6fa';

export function resolveMainWindowSurfaceOptions(
  platform: NodeJS.Platform = process.platform,
): MainWindowSurfaceOptions {
  if (platform === 'win32') {
    // The renderer already paints an opaque full-window shell. Keeping the HWND
    // transparent only opts Chromium into a less stable Windows composition path.
    return {
      transparent: false,
      backgroundColor: windowsMainWindowBackgroundColor,
    };
  }

  return {
    transparent: platform !== 'darwin',
    backgroundColor: '#00000000',
  };
}
