import { isRuntimeInlineMessageAttachment, type RuntimeMessage } from '@setsuna-desktop/contracts';
import type { ConfigStore } from '../ports/config-store.js';

/** 集中处理各轮次入口共用的模型能力检查。 */
export class RuntimeModelInputGuard {
  constructor(private readonly configStore?: ConfigStore) {}

  async assertAttachmentsSupported(attachments: NonNullable<RuntimeMessage['attachments']>): Promise<void> {
    if (!attachments.some((attachment) => isRuntimeInlineMessageAttachment(attachment) && attachment.type.startsWith('image/'))) return;
    const activeProvider = await this.configStore?.getActiveProviderConfig().catch(() => null);
    if (!activeProvider || activeProvider.activeModel?.supportsImages) return;
    throw new Error('当前模型未启用图片输入。');
  }
}
