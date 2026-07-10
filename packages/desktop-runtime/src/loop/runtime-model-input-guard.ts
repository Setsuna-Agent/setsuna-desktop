import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { ConfigStore } from '../ports/config-store.js';

/** Centralizes model capability checks shared by turn entry points. */
export class RuntimeModelInputGuard {
  constructor(private readonly configStore?: ConfigStore) {}

  async assertAttachmentsSupported(attachments: NonNullable<RuntimeMessage['attachments']>): Promise<void> {
    if (!attachments.some((attachment) => attachment.type.startsWith('image/'))) return;
    const activeProvider = await this.configStore?.getActiveProviderConfig().catch(() => null);
    if (!activeProvider || activeProvider.activeModel?.supportsImages) return;
    throw new Error('当前模型未启用图片输入。');
  }
}
