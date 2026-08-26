import type { RuntimePluginInstallResult } from '@setsuna-desktop/contracts';

export const PLUGIN_MANAGEMENT_IPC_CHANNELS = Object.freeze({
  installLocal: 'desktop-plugin-management:install-local',
} as const);

export interface PluginManagementDesktopBridge {
  /** Opens the native directory picker and installs the selected Plugin Bundle. */
  installLocal(): Promise<RuntimePluginInstallResult | null>;
}

export type PluginManagementPreloadBridgeContribution = Readonly<{
  plugins: PluginManagementDesktopBridge;
}>;
