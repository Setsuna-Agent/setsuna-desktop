import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';
import { AppRouteTopbarPortal } from './AppRouteTopbarPortal.js';
import '../styles/route-breadcrumb.css';

type BreadcrumbParent = Readonly<{ label: string; onClick?: () => void }>;

/** Keep nested page navigation in the shell header, outside each page's scroll container. */
export function AppRouteBreadcrumb({ currentLabel, parents, onBack }: Readonly<{
  currentLabel: string;
  parents: readonly BreadcrumbParent[];
  onBack?: () => void;
}>) {
  const { t } = useI18n();
  return (
    <AppRouteTopbarPortal>
      <nav className="app-route-breadcrumb" aria-label={[...parents.map((parent) => parent.label), currentLabel].join(' / ')}>
        {onBack ? <IconButton label={t('common.back')} onClick={onBack}><ArrowLeft size={14} /></IconButton> : null}
        {parents.map((parent, index) => (
          <Fragment key={index}>
            {parent.onClick ? (
              <Button variant="ghost" onClick={parent.onClick}>{parent.label}</Button>
            ) : <span>{parent.label}</span>}
            <ChevronRight aria-hidden="true" />
          </Fragment>
        ))}
        <span aria-current="page" title={currentLabel}>{currentLabel}</span>
      </nav>
    </AppRouteTopbarPortal>
  );
}
