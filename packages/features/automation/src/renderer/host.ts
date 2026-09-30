import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { ComponentType } from 'react';
import type { AutomationModel } from '../contracts/index.js';

export type AutomationModelPickerProps = Readonly<{
  models: readonly AutomationModel[];
  value?: RuntimeConfiguredModelReference;
  disabled?: boolean;
  translate: RendererTranslate;
  onChange(value: RuntimeConfiguredModelReference | undefined): void;
}>;

export type AutomationRendererHost = Readonly<{
  ModelPicker: ComponentType<AutomationModelPickerProps>;
}>;

export const automationRendererHostCapability = defineCapability<AutomationRendererHost>({
  id: 'automation.renderer-host',
  description: 'Desktop model selection and branding for scheduled tasks',
});
