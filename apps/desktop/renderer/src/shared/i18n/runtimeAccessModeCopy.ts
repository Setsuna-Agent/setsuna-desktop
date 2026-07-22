import type { RuntimeAccessMode } from '../lib/runtimeAccessMode.js';
import type { Translate } from './I18nProvider.js';

export type LocalizedRuntimeAccessModeOption = {
  description: string;
  label: string;
  value: RuntimeAccessMode;
};

export function localizedRuntimeAccessModeOptions(t: Translate): LocalizedRuntimeAccessModeOption[] {
  return [
    {
      value: 'request-approval',
      label: t('accessMode.request.label'),
      description: t('accessMode.request.description'),
    },
    {
      value: 'agent-approval',
      label: t('accessMode.agent.label'),
      description: t('accessMode.agent.description'),
    },
    {
      value: 'full-access',
      label: t('accessMode.full.label'),
      description: t('accessMode.full.description'),
    },
  ];
}
