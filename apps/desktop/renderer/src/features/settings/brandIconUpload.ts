import {
  BRAND_ICON_MAX_BYTES,
  BRAND_ICON_MIME_TYPES,
  normalizeBrandIconConfig,
  type BrandIconConfig,
} from '@setsuna-desktop/contracts';

type BrandIconFileMetadata = Pick<File, 'name' | 'size' | 'type'>;
type CustomBrandIcon = Extract<BrandIconConfig, { type: 'custom' }>;

export const brandIconFileAccept = BRAND_ICON_MIME_TYPES.join(',');
export const brandIconMaxSizeLabel = `${Math.round(BRAND_ICON_MAX_BYTES / 1024)} KB`;

export function brandIconFileError(file: BrandIconFileMetadata): string | null {
  if (!BRAND_ICON_MIME_TYPES.includes(file.type.toLocaleLowerCase() as typeof BRAND_ICON_MIME_TYPES[number])) {
    return '请选择 PNG、JPEG 或 WebP 图片。';
  }
  if (file.size <= 0) return '图片文件为空，请选择其他文件。';
  if (file.size > BRAND_ICON_MAX_BYTES) return `图片不能超过 ${brandIconMaxSizeLabel}。`;
  return null;
}

export function readBrandIconFile(file: File): Promise<CustomBrandIcon> {
  const validationError = brandIconFileError(file);
  if (validationError) return Promise.reject(new Error(validationError));

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败，请重试。'));
    reader.onload = () => {
      const icon = normalizeBrandIconConfig({ type: 'custom', dataUrl: reader.result });
      if (icon?.type !== 'custom') {
        reject(new Error('图片内容无效，请选择其他文件。'));
        return;
      }
      resolve(icon);
    };
    reader.readAsDataURL(file);
  });
}
