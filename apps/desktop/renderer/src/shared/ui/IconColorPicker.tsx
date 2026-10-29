import { IconColorPicker as SharedIconColorPicker } from '@setsuna-desktop/renderer-ui';
import type { ComponentProps } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';

export function IconColorPicker(props: Omit<ComponentProps<typeof SharedIconColorPicker>, 'textColorLabel'>) {
  const { t } = useI18n();
  return <SharedIconColorPicker {...props} textColorLabel={t('common.textColor')} />;
}
