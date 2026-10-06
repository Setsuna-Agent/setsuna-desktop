import {
  ModelProviderRendererProvider,
  useModelProviderRendererService,
  useModelProviderSnapshot,
  type ModelProviderBrandIconPickerProps,
  type ModelProviderBrandIconProps,
  type ModelProviderRendererHost,
  type ModelProviderRendererStateService,
} from '@setsuna-desktop/feature-model-provider/renderer';
import type { SettingsModelPickerProps } from '@setsuna-desktop/renderer-contracts/settings';
import { useMemo, type ReactNode } from 'react';
import { BrandIconMark } from '../shared/branding/BrandIconMark.js';
import { BrandIconPickerDialog } from '../shared/branding/BrandIconPickerDialog.js';
import {
  resolveAutomaticModelBrand,
  resolveAutomaticProviderBrand,
  resolveModelBrand,
  resolveProviderBrand,
} from '../shared/branding/providerBranding.js';
import { ConfiguredModelPicker } from '../shared/ui/model-picker/ConfiguredModelPicker.js';
import { configuredModelOptions } from '../shared/ui/model-picker/modelOptions.js';

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

export function SettingsModelPicker({ models, ...props }: SettingsModelPickerProps) {
  const { state } = useModelProviderSnapshot();
  const options = useMemo(() => configuredModelOptions(models, state), [models, state]);
  return <ConfiguredModelPicker {...props} options={options} />;
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
