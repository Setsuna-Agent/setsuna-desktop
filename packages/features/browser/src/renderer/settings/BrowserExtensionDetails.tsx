import { Switch } from '@setsuna-desktop/renderer-ui';
import { ArrowLeft } from 'lucide-react';
import type { BrowserExtension } from '../../contracts/extensions.js';
import type { useBrowserExtensions } from '../extensions/useBrowserExtensions.js';
import type { BrowserSettingsContentProps } from './types.js';
import { BrowserExtensionControls } from './BrowserExtensionControls.js';

export function BrowserExtensionDetails({ item, controller, onBack, translate: t, ui }: Pick<BrowserSettingsContentProps, 'ui' | 'translate'> & {
  item: BrowserExtension; controller: ReturnType<typeof useBrowserExtensions>; onBack(): void;
}) {
  return <section className="browser-settings-page__card browser-extension-details" aria-label={item.name}>
    <header className="browser-extension-details__header">
      <ui.IconButton label={t('feature.browser.extension.back')} onClick={onBack}><ArrowLeft size={16} /></ui.IconButton>
      {item.icon ? <img className="browser-settings__extension-icon" src={item.icon} alt="" /> : null}
      <h2>{item.name}</h2>
      <div className="browser-extension-details__controls"><BrowserExtensionControls item={item} controller={controller} ui={ui} translate={t} /></div>
    </header>
    <dl className="browser-extension-details__fields">
      {item.description ? <div><dt>{t('feature.browser.extension.description')}</dt><dd>{item.description}</dd></div> : null}
      <div><dt>{t('feature.browser.extension.version')}</dt><dd>{item.version}</dd></div>
      {item.permissions.length ? <div><dt>{t('feature.browser.extension.permissions')}</dt><dd><ul>{item.permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul></dd></div> : null}
      {item.hostPermissions.length ? <div><dt>{t('feature.browser.extension.hostPermissions')}</dt><dd><ul>{item.hostPermissions.map((host) => <li key={host}>{host}</li>)}</ul></dd></div> : null}
    </dl>
    {item.supportsUserScripts ? <div className="browser-extension-details__permission">
      <span>{t('feature.browser.extension.allowUserScripts')}</span>
      <Switch label={t('feature.browser.extension.allowUserScripts')} checked={item.allowUserScripts}
        disabled={controller.busy} onCheckedChange={(allowed) => void controller.setUserScriptsAllowed(item.id, allowed)} />
    </div> : null}
  </section>;
}
