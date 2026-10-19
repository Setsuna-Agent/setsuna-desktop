import type { ReactNode } from 'react';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { BrowserTranslate } from '../messages.js';

/** Inline add/edit card shared by the password and site-permission settings pages. */
export function BrowserSettingsEditor({ title, busy, translate: t, ui, children, onCancel, onSubmit }: {
  title: string;
  busy: boolean;
  translate: BrowserTranslate;
  ui: Pick<SettingsViewUi, 'Button'>;
  children: ReactNode;
  onCancel(): void;
  onSubmit(): void;
}) {
  return <form className="browser-settings-page__card browser-settings-editor" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <h2>{title}</h2>
    <div className="browser-settings-editor__body">{children}</div>
    <footer className="browser-settings-editor__actions">
      <ui.Button disabled={busy} onClick={onCancel}>{t('feature.browser.settings.cancel')}</ui.Button>
      <ui.Button variant="primary" type="submit" disabled={busy}>{t('feature.browser.settings.save')}</ui.Button>
    </footer>
  </form>;
}

/** Stacked label + control; the label element keeps the control's accessible name. */
export function BrowserSettingsField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="browser-settings-editor__field"><span>{label}</span>{children}</label>;
}
