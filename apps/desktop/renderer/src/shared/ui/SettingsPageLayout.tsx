import { useLayoutEffect, useRef } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { SettingsPageHeadingProps, SettingsPageLayoutProps } from '@setsuna-desktop/renderer-contracts/settings';
import { Button, IconButton } from './primitives.js';
import { useI18n } from '../i18n/I18nProvider.js';

export function SettingsPageHeading({ action, description, title }: SettingsPageHeadingProps) {
  return <header className="chat-user-settings__page-heading">
    <div className="chat-user-settings__page-heading-copy">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </div>
    {action}
  </header>;
}

/** Shared by Feature-owned settings pages and nested management views. */
export function SettingsPageLayout({ title, description, action, parent, children }: SettingsPageLayoutProps) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { root.current?.scrollIntoView({ block: 'start' }); }, [title]);
  return <div className="sd-settings-page" ref={root}>
    {parent ? <nav className="sd-settings-page__breadcrumbs" aria-label={t('settings.title')}>
      <IconButton label={t('common.back')} onClick={parent.onBack}><ArrowLeft size={14} /></IconButton>
      <span>{t('settings.title')}</span><ChevronRight size={12} aria-hidden="true" />
      <Button variant="ghost" onClick={parent.onBack}>{parent.label}</Button>
      <ChevronRight size={12} aria-hidden="true" /><span aria-current="page">{title}</span>
    </nav> : null}
    <div className="sd-settings-page__content">
      <SettingsPageHeading title={title} description={description} action={action} />
      {children}
    </div>
  </div>;
}
