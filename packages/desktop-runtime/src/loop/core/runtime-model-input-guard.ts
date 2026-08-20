import {
  isRuntimeInlineMessageAttachment,
  type ProviderModelConfig,
  type RuntimeConfiguredModelReference,
  type RuntimeMessage,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import type { ConfigStore } from '../../ports/config-store.js';
import {
  resolveRuntimeNextTurnModel,
  resolveRuntimeTurnModel,
  type RuntimeResolvedTurnModel,
} from './runtime-thread-model.js';

/** 集中处理各轮次入口共用的模型能力检查。 */
export class RuntimeModelInputGuard {
  constructor(private readonly configStore?: ConfigStore) {}

  async assertAttachmentsSupported(
    attachments: NonNullable<RuntimeMessage['attachments']>,
    model?: ProviderModelConfig,
  ): Promise<void> {
    if (!attachments.some((attachment) => isRuntimeInlineMessageAttachment(attachment) && attachment.type.startsWith('image/'))) return;
    if (model) {
      if (model.supportsImages) return;
      throw new Error('当前模型未启用图片输入。');
    }
    const activeProvider = await this.configStore?.getActiveProviderConfig().catch(() => null);
    if (!activeProvider || activeProvider.activeModel?.supportsImages) return;
    throw new Error('当前模型未启用图片输入。');
  }

  async assertThreadAttachmentsSupported(
    attachments: NonNullable<RuntimeMessage['attachments']>,
    thread: RuntimeThread,
    requested?: RuntimeConfiguredModelReference,
  ): Promise<void> {
    const config = await this.configStore?.getConfig().catch(() => null);
    const turnModel = resolveRuntimeTurnModel(config, thread, requested);
    await this.assertAttachmentsSupported(attachments, turnModel?.model);
  }

  async resolveNextTurnModel(
    thread: RuntimeThread,
    requested?: RuntimeConfiguredModelReference,
  ): Promise<RuntimeResolvedTurnModel | undefined> {
    const config = await this.configStore?.getConfig().catch(() => null);
    return resolveRuntimeNextTurnModel(config, thread, requested);
  }
}
