export interface MainWindowSurfaceOptions {
  transparent: boolean;
  backgroundColor: string;
}

export function resolveMainWindowSurfaceOptions(
  platform: NodeJS.Platform = process.platform,
  dark = false,
): MainWindowSurfaceOptions {
  if (platform === 'win32') {
    // Keep the HWND opaque and match its backing color to the renderer's translucent shell.
    return {
      transparent: false,
      backgroundColor: dark ? '#1b1b1b' : '#f7f6fa',
    };
  }

  return {
    transparent: false,
    backgroundColor: '#00000000',
  };
}
