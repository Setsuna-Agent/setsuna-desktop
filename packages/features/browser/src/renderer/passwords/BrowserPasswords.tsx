import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { Globe2, KeyRound, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { BrowserDesktopBridge } from '../../contracts/index.js';
import type { BrowserNotify } from '../types.js';
import type { BrowserTranslate } from '../messages.js';
import { useBrowserPasswords } from './useBrowserPasswords.js';
import './passwords.css';

export function BrowserPasswords(props: {
  bridge: BrowserDesktopBridge | null;
  tabId: string;
  active: boolean;
  hidden: boolean;
  notify: BrowserNotify;
  translate: BrowserTranslate;
}) {
  const { translate: t } = props;
  const passwords = useBrowserPasswords(props);
  const { state, open, busy, setOpen } = passwords;
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const visible = open && !props.hidden && props.active;
  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
  }, [setOpen, visible]);
  const prompt = state?.prompt;
  const origin = prompt?.origin ?? state?.origin ?? '';
  const site = origin.replace(/^https?:\/\//, '');
  const title = t(prompt ? (prompt.update ? 'feature.browser.password.updateTitle' : 'feature.browser.password.saveTitle') : 'feature.browser.password.label');
  return <span className="browser-passwords" ref={root}>
    <Button variant="ghost" type="button" ref={trigger} className={`desktop-browser-navigation__button${prompt || visible ? ' is-active' : ''}`}
      aria-label={t('feature.browser.password.label')} title={t('feature.browser.password.label')}
      aria-haspopup="dialog" aria-expanded={visible}
      disabled={!props.active || (!prompt && !state?.logins.length)} onClick={() => setOpen(!open)}><KeyRound size={14} /></Button>
    {visible && state ? <div className={`browser-passwords__popover${prompt ? '' : ' browser-passwords__popover--accounts'}`} role="dialog" aria-label={title}>
      <div className="browser-passwords__header">
        {prompt ? <div className="browser-passwords__heading">
          <strong>{title}</strong>
          <span className="browser-passwords__origin" title={origin}>{origin}</span>
        </div> : <span className="browser-passwords__site" title={origin}>
          <Globe2 size={12} aria-hidden="true" /><span>{site}</span>
        </span>}
        <IconButton className="browser-passwords__close" label={t('feature.browser.password.close')}
          disabled={busy} onClick={passwords.dismiss}><X size={14} /></IconButton>
      </div>
      {prompt ? <>
        <dl className="browser-passwords__fields">
          <div className="browser-passwords__field">
            <dt>{t('feature.browser.password.username')}</dt>
            <dd title={prompt.username}>{prompt.username || t('feature.browser.password.noUsername')}</dd>
          </div>
          <div className="browser-passwords__field">
            <dt>{t('feature.browser.password.password')}</dt><dd className="browser-passwords__masked">••••••••</dd>
          </div>
        </dl>
        <div className="browser-passwords__actions">
          <Button size="small" variant="ghost" disabled={busy} onClick={passwords.dismiss}>{t('feature.browser.password.notNow')}</Button>
          <Button size="small" variant="primary" disabled={busy} onClick={passwords.save}>{t(prompt.update ? 'feature.browser.password.update' : 'feature.browser.password.save')}</Button>
        </div>
      </> : <ul className="browser-passwords__logins">{state.logins.map((login) => <li key={login.id}>
        <Button className="browser-passwords__fill" variant="ghost" disabled={busy || !state.available} title={t('feature.browser.password.fill')}
          onClick={() => passwords.fill(login.id)}>
          <UserRound size={14} aria-hidden="true" /><span>{login.username || t('feature.browser.password.noUsername')}</span>
        </Button>
        <IconButton className="browser-passwords__delete" label={`${t('feature.browser.password.delete')} ${login.username}`} disabled={busy}
          onClick={() => passwords.remove(login.id)}><Trash2 size={13} /></IconButton>
      </li>)}</ul>}
    </div> : null}
  </span>;
}
