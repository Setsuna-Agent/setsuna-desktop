import type { ProviderConfigState, ProviderModelConfig } from '@setsuna-desktop/contracts';
import { CircleOff, MessagesSquare } from 'lucide-react';
import { BrandIconMark } from '../../../shared/branding/BrandIconMark.js';
import { resolveModelBrand } from '../../../shared/branding/providerBranding.js';

type TaskModelOptionLabelProps = {
  label: string;
  model?: ProviderModelConfig;
  provider?: ProviderConfigState;
  variant?: 'follow-current' | 'model' | 'unavailable';
};

export function TaskModelOptionLabel({
  label,
  model,
  provider,
  variant = 'model',
}: TaskModelOptionLabelProps) {
  return (
    <span className="task-model-option-label">
      {model && provider ? (
        <BrandIconMark
          brand={resolveModelBrand(model, provider)}
          fallbackName={model.name || model.code || provider.name}
          size="compact"
        />
      ) : variant === 'unavailable' ? (
        <CircleOff aria-hidden="true" size={16} />
      ) : (
        <MessagesSquare aria-hidden="true" size={16} />
      )}
      <span className="task-model-option-label__text">{label}</span>
    </span>
  );
}
