import type { ProviderConfigState, RuntimeConfigInput, RuntimeConfigState } from '@setsuna-desktop/contracts';

export type RuntimeProviderConfig = Omit<ProviderConfigState, 'apiKeySet' | 'apiKeyPreview'> & {
  apiKey: string;
  activeModel?: ProviderConfigState['models'][number];
};

export type ConfigStore = {
  getConfig(): Promise<RuntimeConfigState>;
  saveConfig(input: RuntimeConfigInput): Promise<RuntimeConfigState>;
  getActiveProviderConfig(): Promise<RuntimeProviderConfig | null>;
  /** 对只模拟当前供应商的聚焦测试存储而言，此项可选。 */
  getProviderConfig?(providerId: string): Promise<RuntimeProviderConfig | null>;
};
