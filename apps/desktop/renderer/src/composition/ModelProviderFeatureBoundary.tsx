import {
  ModelProviderRendererProvider,
  useModelProviderRendererService,
  type ModelProviderBrandIconPickerProps,
  type ModelProviderBrandIconProps,
  type ModelProviderRendererHost,
  type ModelProviderRendererStateService,
} from '@setsuna-desktop/feature-model-provider/renderer';
import type { ReactNode } from 'react';
import { BrandIconMark } from '../shared/branding/BrandIconMark.js';
import { BrandIconPickerDialog } from '../shared/branding/BrandIconPickerDialog.js';
import {
  resolveAutomaticModelBrand,
  resolveAutomaticProviderBrand,
  resolveModelBrand,
  resolveProviderBrand,
} from '../shared/branding/providerBranding.js';

export const modelProviderRendererHost: Pick<ModelProviderRendererHost, 'BrandIcon' | 'BrandIconPicker'> = Object.freeze({
  BrandIcon: ModelProviderBrandIcon,
  BrandIconPicker: ModelProviderBrandIconPicker,
});

export function ModelProviderFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: ModelProviderRendererStateService;
}>) {
  return <ModelProviderRendererProvider service={service}>{children}</ModelProviderRendererProvider>;
}

export function useModelProviderFeatureService(): ModelProviderRendererStateService {
  return useModelProviderRendererService();
}

function ModelProviderBrandIcon({ model, provider, size = 'default' }: ModelProviderBrandIconProps) {
  const fallbackName = model?.name || model?.code || provider.name;
  const brand = model ? resolveModelBrand(model, provider) : resolveProviderBrand(provider);
  return <BrandIconMark brand={brand} fallbackName={fallbackName} size={size} />;
}

function ModelProviderBrandIconPicker({
  icon,
  model,
  provider,
  onClose,
  onConfirm,
}: ModelProviderBrandIconPickerProps) {
  return (
    <BrandIconPickerDialog
      automaticBrand={model
        ? resolveAutomaticModelBrand(model, provider)
        : resolveAutomaticProviderBrand(provider)}
      icon={icon}
      name={model?.name || model?.code || provider.name}
      subject={model ? 'model' : 'provider'}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
