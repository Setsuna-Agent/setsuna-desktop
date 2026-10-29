import {
  BRAND_ICON_MAX_BYTES,
  BRAND_ICON_MIME_TYPES,
  normalizeBrandIconConfig,
  type BrandIconConfig,
} from '@setsuna-desktop/contracts';
import { imageFileError, readImageFile } from '@setsuna-desktop/renderer-ui';

type BrandIconFileMetadata = Pick<File, 'name' | 'size' | 'type'>;
type CustomBrandIcon = Extract<BrandIconConfig, { type: 'custom' }>;

export type BrandIconUploadCopy = {
  emptyFile: string;
  invalidContent: string;
  invalidType: string;
  readError: string;
  tooLarge: string;
};

const defaultUploadCopy: BrandIconUploadCopy = {
  emptyFile: '图片文件为空，请选择其他文件。',
  invalidContent: '图片内容无效，请选择其他文件。',
  invalidType: '请选择 PNG、JPEG 或 WebP 图片。',
  readError: '图片读取失败，请重试。',
  tooLarge: `图片不能超过 ${Math.round(BRAND_ICON_MAX_BYTES / 1024)} KB。`,
};

export const brandIconFileAccept = BRAND_ICON_MIME_TYPES.join(',');
export const brandIconMaxSizeLabel = `${Math.round(BRAND_ICON_MAX_BYTES / 1024)} KB`;

export function brandIconFileError(
  file: BrandIconFileMetadata,
  copy: BrandIconUploadCopy = defaultUploadCopy,
): string | null {
  return imageFileError(file, { mimeTypes: BRAND_ICON_MIME_TYPES, maxBytes: BRAND_ICON_MAX_BYTES, copy });
}

export async function readBrandIconFile(
  file: File,
  copy: BrandIconUploadCopy = defaultUploadCopy,
): Promise<CustomBrandIcon> {
  const dataUrl = await readImageFile(file, { mimeTypes: BRAND_ICON_MIME_TYPES, maxBytes: BRAND_ICON_MAX_BYTES, copy });
  const icon = normalizeBrandIconConfig({ type: 'custom', dataUrl });
  if (icon?.type !== 'custom') throw new Error(copy.invalidContent);
  return icon;
}
