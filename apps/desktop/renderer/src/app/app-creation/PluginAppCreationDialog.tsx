import { Button, Dialog } from '@setsuna-desktop/renderer-ui';
import { ArrowRight, ArrowUpRight, PanelsTopLeft } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { AppTemplatePreview, type AppTemplateKind } from './AppTemplatePreview.js';
import './app-creation.css';

const shortcuts = ['table', 'form', 'chart', 'conversations', 'custom'] as const;
const steps = ['stepDescribe', 'stepCreate', 'stepRefine'] as const;

export function PluginAppCreationDialog({ pending, error, onClose, onCloseAutoFocus, onSelect }: Readonly<{
  pending: boolean;
  error: string | null;
  onClose(): void;
  onCloseAutoFocus(event: Event): void;
  onSelect(prompt: string): void;
}>) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<AppTemplateKind | null>(null);
  const select = (id: AppTemplateKind) => {
    setSelected(id);
    onSelect(t(`appCreation.${id}.prompt`));
  };

  return <Dialog
    title={<span className="plugin-app-creation__eyebrow">
      <PanelsTopLeft size={15} aria-hidden="true" />{t('appCreation.title')}
    </span>}
    className="plugin-app-creation-dialog" width={800} dismissible={!pending}
    onClose={onClose} onCloseAutoFocus={onCloseAutoFocus}>
    <div className="plugin-app-creation">
      <div className="plugin-app-creation__hero">
        <h2>{t('appCreation.headline')}</h2>
        <p>{t('appCreation.intro')}</p>
        <ol className="plugin-app-creation__steps">
          {steps.map((step, index) => <li key={step}>
            <span className="plugin-app-creation__step-number" aria-hidden="true">{index + 1}</span>
            <span>{t(`appCreation.${step}`)}</span>
            {index < steps.length - 1 ? <ArrowRight size={12} aria-hidden="true" /> : null}
          </li>)}
        </ol>
      </div>
      <div className="plugin-app-creation__shortcuts">
        {shortcuts.map((id) => (
          <Button key={id} type="button"
            className={`plugin-app-creation__shortcut plugin-app-creation__shortcut--${id}`}
            disabled={pending} aria-busy={pending && selected === id} onClick={() => select(id)}>
            <span className="plugin-app-creation__art"><AppTemplatePreview kind={id} /></span>
            <span className="plugin-app-creation__shortcut-label">
              <span>{t(`appCreation.${id}.title`)}</span>
              {pending && selected === id
                ? <span className="sd-spinner" aria-hidden="true" />
                : <ArrowUpRight size={15} aria-hidden="true" />}
            </span>
          </Button>
        ))}
      </div>
      {error ? <p role="alert" className="plugin-app-creation__error">{error}</p> : null}
    </div>
  </Dialog>;
}
