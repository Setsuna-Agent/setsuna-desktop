import type { DesktopImageInput, WorkspaceProjectTarget } from '@setsuna-desktop/contracts';

export type WorkspaceImageSource = { filePath: string } & (
  | { dataUrl: string }
  | { workspace: WorkspaceProjectTarget }
);

/** File names control menu availability; runtime still validates the actual content on copy. */
export function isWorkspaceImagePath(filePath: string): boolean {
  return /\.(?:bmp|gif|jpe?g|png|svg|webp|ico)$/iu.test(filePath);
}

/** Decode only on copy: Chromium supports more preview formats than the native clipboard. */
export async function workspaceImageClipboardInput(dataUrl: string, filePath: string): Promise<DesktopImageInput> {
  const name = filePath.split('/').pop() ?? filePath;
  if (/^data:image\/(?:png|jpeg);base64,/u.test(dataUrl)) return { dataUrl, name };

  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height) throw new Error('Image data could not be decoded.');
  // Keep the original dimensions and transparency instead of copying the scaled preview.
  context.drawImage(image, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), name };
}
