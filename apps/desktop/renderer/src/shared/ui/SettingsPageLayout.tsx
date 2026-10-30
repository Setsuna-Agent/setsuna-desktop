import { useRef } from 'react';
import { usePageScrollRestoration } from '@setsuna-desktop/renderer-ui';
import type { SettingsPageHeadingProps, SettingsPageLayoutProps } from '@setsuna-desktop/renderer-contracts/settings';
import { useI18n } from '../i18n/I18nProvider.js';
import { AppRouteBreadcrumb } from './AppRouteBreadcrumb.js';

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
export function SettingsPageLayout({ title, description, action, parent, showHeading = true, children }: SettingsPageLayoutProps) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  usePageScrollRestoration(`settings:page:${parent?.label ?? ''}:${title}`, root, { closest: '[data-settings-scroll-container]' });
  return <div className="sd-settings-page" ref={root}>
    {parent ? <AppRouteBreadcrumb currentLabel={title} onBack={parent.onBack}
      parents={[{ label: t('settings.title') }, { label: parent.label, onClick: parent.onBack }]} /> : null}
    <div className="sd-settings-page__content">
      {showHeading ? <SettingsPageHeading title={title} description={description} action={action} /> : null}
      {children}
    </div>
  </div>;
}
