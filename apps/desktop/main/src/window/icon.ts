import { app, nativeImage, type NativeImage } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveDesktopIconPath(): string | undefined {
  // Windows supplies its own spacing around taskbar, tray and notification icons.
  const fileName = process.platform === 'win32' ? 'icon-windows.png' : 'icon.png';
  const relativePath = path.join('assets', 'build', fileName);
  return [
    path.join(app.getAppPath(), relativePath),
    path.join(process.resourcesPath, fileName),
    path.join(process.resourcesPath, relativePath),
  ].find((candidate) => existsSync(candidate));
}

export function loadDesktopIcon(): NativeImage | undefined {
  const iconPath = resolveDesktopIconPath();
  if (!iconPath) return undefined;
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}
