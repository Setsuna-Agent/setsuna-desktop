import { Button } from '@setsuna-desktop/renderer-ui';
import { useId } from 'react';
import { BrowserFeatureIcon } from '../BrowserFeatureIcon.js';
import type { BrowserTranslate } from '../messages.js';
import { browserLoadErrorInfo } from './browserLoadError.js';
import './load-error.css';

export function BrowserLoadErrorPage({ error, onReload, translate, url }: {
  error: string;
  onReload: () => void;
  translate: BrowserTranslate;
  url: string;
}) {
  const titleId = useId();
  const { code, host, reason } = browserLoadErrorInfo(error, url);
  return (
    <div className="desktop-browser-load-error">
      <section className="desktop-browser-load-error__content" role="alert" aria-labelledby={titleId}>
        <BrowserFeatureIcon className="desktop-browser-load-error__icon" size={28} />
        <h1 id={titleId}>{translate('feature.browser.loadFailed')}</h1>
        <p className="desktop-browser-load-error__reason">{translate(`feature.browser.error.${reason}`, { host })}</p>
        {reason !== 'certificate' ? (
          <div className="desktop-browser-load-error__suggestions">
            <p>{translate('feature.browser.error.try')}</p>
            <ul>
              <li>{translate('feature.browser.error.checkConnection')}</li>
              <li>{translate('feature.browser.error.checkProxy')}</li>
            </ul>
          </div>
        ) : null}
        {code ? <p className="desktop-browser-load-error__code">{code}</p> : null}
        <Button className="desktop-browser-load-error__reload" onClick={onReload}>
          {translate('feature.browser.error.reload')}
        </Button>
      </section>
    </div>
  );
}
