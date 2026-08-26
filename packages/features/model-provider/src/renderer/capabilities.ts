import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { NetworkProxyDesktopBridge } from '@setsuna-desktop/feature-network-proxy/contracts';
import type { BrandIconConfig, ProviderConfigState, ProviderModelConfig } from '@setsuna-desktop/contracts';
import type { ComponentType } from 'react';
import type { ModelProviderRendererStateService } from './service.js';

export type ModelProviderBrandIconProps = Readonly<{
  provider: ProviderConfigState;
  model?: ProviderModelConfig;
  size?: 'compact' | 'default' | 'large';
}>;

export type ModelProviderBrandIconPickerProps = Readonly<{
  icon?: BrandIconConfig;
  model?: ProviderModelConfig;
  provider: ProviderConfigState;
  onClose(): void;
  onConfirm(icon: BrandIconConfig | undefined): void;
}>;

export type ModelProviderRendererHost = Readonly<{
  BrandIcon: ComponentType<ModelProviderBrandIconProps>;
  BrandIconPicker: ComponentType<ModelProviderBrandIconPickerProps>;
  networkProxyBridge: NetworkProxyDesktopBridge | null;
}>;

export const modelProviderRendererHostCapability: CapabilityToken<ModelProviderRendererHost> = defineCapability({
  id: 'model-provider.renderer-host',
  description: 'Desktop branding and proxy bridges used by model provider settings',
});

export const modelProviderRendererStateCapability: CapabilityToken<ModelProviderRendererStateService> = defineCapability({
  id: 'model-provider.renderer-state',
  description: 'Single renderer owner for model provider settings and model discovery',
});
