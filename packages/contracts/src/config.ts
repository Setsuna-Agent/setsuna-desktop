import type { ModelProviderKind } from './provider.js';

export type ProviderConfigState = {
  id: string;
  name: string;
  provider: ModelProviderKind;
  baseUrl: string;
  enabled: boolean;
  apiKeySet: boolean;
  apiKeyPreview: string;
  models: ProviderModelConfig[];
};

export type ProviderModelConfig = {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
  maxOutputTokens: number;
  thinkingEnabled: boolean;
  thinkingEfforts: string[];
  defaultThinkingEffort?: string;
  supportsImages?: boolean;
};

export type RuntimeSetsunaStyle = 'developer' | 'daily';

export type RuntimeConfigState = {
  configPath: string;
  dataPath: string;
  storagePath: string;
  activeProviderId?: string;
  providers: ProviderConfigState[];
  globalPrompt: string;
  memoryEnabled: boolean;
  setsunaStyle: RuntimeSetsunaStyle;
  approvalPolicy: 'strict' | 'on-request' | 'full';
  permissionProfile: RuntimePermissionProfile;
  sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite;
  features?: Record<string, boolean>;
  desktopSettings?: Record<string, unknown>;
};

export type RuntimePermissionProfile = 'read-only' | 'workspace-write' | 'danger-full-access';

export type RuntimeSandboxWorkspaceWrite = {
  writableRoots?: string[];
  networkAccess?: boolean;
  excludeTmpdirEnvVar?: boolean;
  excludeSlashTmp?: boolean;
};

export type RuntimeAvailableModel = {
  id: string;
  name: string;
  maxOutputTokens?: number;
  thinkingEnabled?: boolean;
  thinkingEfforts?: string[];
  defaultThinkingEffort?: string;
  supportsImages?: boolean;
};

export type RuntimeFetchModelsInput = {
  providerId?: string;
  provider?: ModelProviderKind;
  baseUrl?: string;
  apiKey?: string;
};

export type RuntimeAvailableModelsResponse = {
  models: RuntimeAvailableModel[];
};

export type ProviderConfigInput = {
  id?: string;
  name?: string;
  provider?: ModelProviderKind;
  baseUrl?: string;
  enabled?: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
  models?: ProviderModelConfig[];
};

export type RuntimeConfigInput = {
  activeProviderId?: string;
  globalPrompt?: string;
  storagePath?: string;
  memoryEnabled?: boolean;
  setsunaStyle?: RuntimeSetsunaStyle | string;
  approvalPolicy?: RuntimeConfigState['approvalPolicy'];
  permissionProfile?: RuntimePermissionProfile;
  sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite;
  features?: Record<string, boolean>;
  desktopSettings?: Record<string, unknown>;
  providers?: ProviderConfigInput[];
};
