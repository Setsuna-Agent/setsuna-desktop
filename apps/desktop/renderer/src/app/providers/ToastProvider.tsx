import { ToastProvider as SharedToastProvider } from '@setsuna-desktop/renderer-ui';
import type { PropsWithChildren } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export { enqueueToast, useToast, type ToastApi, type ToastEntry, type ToastOptions, type ToastTone } from '@setsuna-desktop/renderer-ui';

export function ToastProvider({ children }: PropsWithChildren) {
  const { t } = useI18n();
  return <SharedToastProvider label={t('toast.region')} closeLabel={t('toast.close')}>
    {children}
  </SharedToastProvider>;
}
