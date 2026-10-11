import { normalizeBrandIconConfig, type BrandIconConfig } from '@setsuna-desktop/contracts';

/** Rasterize native-fetched ICO/SVG icons into the existing persisted avatar format. */
export async function websiteIconToAvatar(dataUrl: string | null): Promise<Extract<BrandIconConfig, { type: 'custom' }>> {
  if (!dataUrl || dataUrl.length > 700_000 || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
    throw new Error('Website icon is unavailable.');
  }
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Website icon has no dimensions.');
  const size = Math.min(128, Math.max(image.naturalWidth, image.naturalHeight));
  const scale = size / Math.max(image.naturalWidth, image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Website icon could not be converted.');
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  const avatar = normalizeBrandIconConfig({ type: 'custom', dataUrl: canvas.toDataURL('image/png') });
  if (avatar?.type !== 'custom') throw new Error('Website icon could not be saved.');
  return avatar;
}
