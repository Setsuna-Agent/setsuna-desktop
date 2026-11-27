import { ChevronRight, Copy, ExternalLink, Link, LockKeyhole } from 'lucide-react';
import type { FormEvent } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton, TextField } from '@setsuna-desktop/renderer-ui';
import { maxDesignPreviewPasswordLength, type DesignPreviewAccess } from '../../contracts/design-publication.js';

const accessModes = [
  { kind: 'link', Icon: Link, label: 'feature.design.publication.linkAccess' },
  { kind: 'password', Icon: LockKeyhole, label: 'feature.design.publication.passwordAccess' },
] as const;

export function DesignShareAccessRow({ id, access, disabled, onEdit, translate: t }: Readonly<{
  id: string;
  access: DesignPreviewAccess['kind'];
  disabled: boolean;
  onEdit(): void;
  translate: RendererTranslate;
}>) {
  const { Icon, label } = access === 'link' ? accessModes[0] : accessModes[1];
  return <Button id={id} variant="ghost" className="design-share-access-row" disabled={disabled} onClick={onEdit}>
    <Icon size={16} aria-hidden="true" />
    <span>{t('feature.design.publication.accessMode')}</span>
    <span className="design-share-access-row__value">{t(label)}</span>
    <ChevronRight size={15} aria-hidden="true" />
  </Button>;
}

export function DesignShareAccessForm({ id, access, password, disabled, onAccess, onPassword, onSubmit, translate: t }: Readonly<{
  id: string;
  access: DesignPreviewAccess['kind'];
  password: string;
  disabled: boolean;
  onAccess(access: DesignPreviewAccess['kind']): void;
  onPassword(password: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  translate: RendererTranslate;
}>) {
  return <form id={id} className="design-share-access-form" onSubmit={onSubmit}>
    <fieldset disabled={disabled}>
      <legend>{t('feature.design.publication.accessMode')}</legend>
      <div className="design-share-access-options">
        {accessModes.map(({ kind, Icon, label }) => <label key={kind} className="design-share-access-option">
          <Icon size={16} aria-hidden="true" />
          <span>{t(label)}</span>
          <input id={`${id}-${kind}`} type="radio" name={`${id}-access`} value={kind} checked={access === kind}
            onChange={() => onAccess(kind)} />
        </label>)}
      </div>
    </fieldset>
    {access === 'password' ? <label className="design-share-password" htmlFor={`${id}-password-field`}>
      {t('feature.design.publication.password')}
      <TextField id={`${id}-password-field`} type="password" value={password} autoComplete="new-password" maxLength={maxDesignPreviewPasswordLength}
        required disabled={disabled} onChange={(event) => onPassword(event.currentTarget.value)} />
    </label> : null}
    <p className="design-share-network-note">{t('feature.design.publication.trustedNetwork')}</p>
  </form>;
}

export function DesignShareAddresses({ urls, copyId, disabled, onCopy, onOpen, translate: t }: Readonly<{
  urls: readonly string[];
  copyId: string;
  disabled: boolean;
  onCopy(url: string): void;
  onOpen?: (url: string) => void;
  translate: RendererTranslate;
}>) {
  return <ul className="design-share-addresses" aria-label={t('feature.design.publication.link')}>
    {urls.map((url, index) => {
      const address = new URL(url).host;
      const primary = index === 0;
      return <li key={address} className={primary ? 'design-share-address design-share-address--primary' : 'design-share-address'}>
        {primary ? <span className="design-share-mark" aria-hidden="true"><Link size={18} /></span> : null}
        <span className="design-share-address__host">{address}</span>
        {primary ? <Button id={copyId} variant="primary" size="small" disabled={disabled}
          icon={<Copy size={14} aria-hidden="true" />} onClick={() => onCopy(url)}>{t('feature.design.publication.copyLink')}</Button>
          : <IconButton size="small" label={t('feature.design.publication.copyAddress', { address })} title={t('feature.design.publication.copyLink')}
            disabled={disabled} onClick={() => onCopy(url)}><Copy size={15} aria-hidden="true" /></IconButton>}
        <IconButton size="small" label={t('feature.design.publication.openAddress', { address })} title={t('feature.design.publication.openLink')}
          disabled={disabled || !onOpen} onClick={() => onOpen?.(url)}><ExternalLink size={15} aria-hidden="true" /></IconButton>
      </li>;
    })}
  </ul>;
}
