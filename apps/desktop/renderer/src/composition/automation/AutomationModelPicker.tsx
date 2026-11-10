import type { AutomationModelPickerProps } from '@setsuna-desktop/feature-automation/renderer';
import { FeatureModelPicker } from '../feature-ui/FeatureModelPicker.js';

export function AutomationModelPicker({ translate, ...props }: AutomationModelPickerProps) {
  return <FeatureModelPicker {...props} label={translate('feature.automation.model')} defaultLabel={translate('feature.automation.defaultModel')} />;
}
