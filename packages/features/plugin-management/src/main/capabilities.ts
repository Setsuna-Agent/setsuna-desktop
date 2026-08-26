import type {
  RuntimeInterfaceLanguage,
  RuntimePluginInstallResult,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';

export interface PluginManagementMainHost {
  installLocal(path: string): Promise<RuntimePluginInstallResult>;
  interfaceLanguage(): RuntimeInterfaceLanguage;
  isRendererSender(senderId: number): boolean;
  selectLocalBundle(title: string): Promise<string | null>;
}

export const pluginManagementMainHostCapability: CapabilityToken<PluginManagementMainHost> = defineCapability({
  id: 'plugin-management.main-host',
  description: 'Native directory selection, renderer sender policy, and runtime access for local Plugin installation',
});
