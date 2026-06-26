import type { ProviderConfigState, RuntimeConfigInput, RuntimeConfigState } from '@setsuna-desktop/contracts';

export type RuntimeProviderConfig = Omit<ProviderConfigState, 'apiKeySet' | 'apiKeyPreview'> & {
  apiKey: string;
  activeModel?: ProviderConfigState['models'][number];
};

export type ConfigStore = {
  getConfig(): Promise<RuntimeConfigState>;
  saveConfig(input: RuntimeConfigInput): Promise<RuntimeConfigState>;
  getActiveProviderConfig(): Promise<RuntimeProviderConfig | null>;
};
