import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { SettingsTooltipProps } from '@setsuna-desktop/feature-core/renderer';
import type { ComponentType } from 'react';
import type { UsageProviderDescriptor } from '../contracts/index.js';

export type UsageBrandIconProps = Readonly<{
  kind: 'model' | 'provider';
  name: string;
  providerId?: string;
  providerName?: string;
  providers: readonly UsageProviderDescriptor[];
}>;

export type UsageRendererHost = Readonly<{
  BrandIcon: ComponentType<UsageBrandIconProps>;
  Tooltip: ComponentType<SettingsTooltipProps>;
}>;

export const usageRendererHostCapability: CapabilityToken<UsageRendererHost> = defineCapability({
  id: 'usage.renderer-host',
  description: 'Host branding and tooltip primitives used by Usage views',
});
