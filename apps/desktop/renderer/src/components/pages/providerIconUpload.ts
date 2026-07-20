import {
  normalizeProviderIconConfig,
  PROVIDER_CUSTOM_ICON_MAX_BYTES,
  PROVIDER_CUSTOM_ICON_MIME_TYPES,
  type ProviderIconConfig,
} from '@setsuna-desktop/contracts';

type ProviderIconFileMetadata = Pick<File, 'name' | 'size' | 'type'>;
type CustomProviderIcon = Extract<ProviderIconConfig, { type: 'custom' }>;

export const providerIconFileAccept = PROVIDER_CUSTOM_ICON_MIME_TYPES.join(',');
export const providerIconMaxSizeLabel = `${Math.round(PROVIDER_CUSTOM_ICON_MAX_BYTES / 1024)} KB`;

export function providerIconFileError(file: ProviderIconFileMetadata): string | null {
  if (!PROVIDER_CUSTOM_ICON_MIME_TYPES.includes(file.type.toLocaleLowerCase() as typeof PROVIDER_CUSTOM_ICON_MIME_TYPES[number])) {
    return '请选择 PNG、JPEG 或 WebP 图片。';
  }
  if (file.size <= 0) return '图片文件为空，请选择其他文件。';
  if (file.size > PROVIDER_CUSTOM_ICON_MAX_BYTES) return `图片不能超过 ${providerIconMaxSizeLabel}。`;
  return null;
}

export function readProviderIconFile(file: File): Promise<CustomProviderIcon> {
  const validationError = providerIconFileError(file);
  if (validationError) return Promise.reject(new Error(validationError));

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败，请重试。'));
    reader.onload = () => {
      const icon = normalizeProviderIconConfig({ type: 'custom', dataUrl: reader.result });
      if (icon?.type !== 'custom') {
        reject(new Error('图片内容无效，请选择其他文件。'));
        return;
      }
      resolve(icon);
    };
    reader.readAsDataURL(file);
  });
}
