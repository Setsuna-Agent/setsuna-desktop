import { Button, Dropdown, IconButton, Popover } from '@setsuna-desktop/renderer-ui';
import { ArrowUpRight, Pin, PinOff, Settings2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { BrowserExtension } from '../../contracts/extensions.js';
import type { BrowserTranslate } from '../messages.js';
import type { useBrowserExtensions } from './useBrowserExtensions.js';
import './extensions.css';

export function BrowserExtensions({ extensions, hidden, translate: t, onOpenSettings, onOpenStore }: {
  extensions: ReturnType<typeof useBrowserExtensions>;
  hidden: boolean;
  translate: BrowserTranslate;
  onOpenSettings?(): void;
  onOpenStore(): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const visible = open && !hidden;
  const enabledExtensions = extensions.extensions.filter((extension) => extension.enabled);
  const activate = (extension: BrowserExtension, button: HTMLButtonElement | null) => {
    const view = extension.hasPopup || extension.hasAction || extension.hasSidePanel ? 'action' : extension.hasOptions ? 'options' : null;
    if (!view) { setOpen(true); return; }
    const rect = view === 'action' ? button?.getBoundingClientRect() : undefined;
    const anchor = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined;
    setOpen(false);
    void extensions.open(extension.id, view, anchor);
  };
  return <span className="browser-extensions">
    {!hidden ? extensions.pinnedExtensions.map((extension) => (
      <Dropdown key={extension.id} trigger={['contextMenu']} disabled={extensions.busy} modal
        onOpenChange={(opened) => { if (opened) setOpen(false); }} menu={{ items: [
          extension.hasOptions && {
            key: 'options', label: t('feature.browser.extension.options'), icon: <Settings2 size={14} />, disabled: extensions.busy,
            onClick: () => { void extensions.open(extension.id, 'options'); },
          },
          {
            key: 'unpin', label: t('feature.browser.extension.unpin'), icon: <PinOff size={14} />,
            onClick: () => extensions.togglePin(extension.id),
          },
          { type: 'divider' },
          {
            key: 'remove', label: t('feature.browser.extension.remove'), icon: <Trash2 size={14} />, danger: true, disabled: extensions.busy,
            onClick: () => { void extensions.remove(extension.id); },
          },
        ] }}>
        <Button variant="ghost" className="desktop-browser-navigation__button browser-extensions__pinned"
          aria-label={extension.name} title={extension.actionTitle} disabled={extensions.busy} onClick={(event) => activate(extension, event.currentTarget)}>
          <BrowserExtensionIcon icon={extension.actionIcon} />
        </Button>
      </Dropdown>
    )) : null}
    <Popover open={visible} onOpenChange={setOpen} modal placement="bottomRight" className="sd-menu-surface browser-extensions__menu"
      contentLabel={t('feature.browser.extension.label')} content={<>
      {enabledExtensions.length ? <ul className="browser-extensions__list">{enabledExtensions.map((extension) => {
        const content = <><BrowserExtensionIcon icon={extension.icon} /><span>{extension.name}</span></>;
        const view = extension.hasPopup || extension.hasAction || extension.hasSidePanel ? 'action' : extension.hasOptions ? 'options' : null;
        const pinned = extensions.pinnedIds.includes(extension.id);
        return <li key={extension.id}>
          {view ? <Button className="browser-extensions__item" variant="ghost" disabled={extensions.busy} title={extension.name}
            onClick={() => activate(extension, trigger.current)}>{content}</Button>
            : <div className="browser-extensions__item" title={extension.name}>{content}</div>}
          <IconButton className="browser-extensions__pin" aria-pressed={pinned}
            label={`${t(pinned ? 'feature.browser.extension.unpin' : 'feature.browser.extension.pin')} ${extension.name}`}
            onClick={() => extensions.togglePin(extension.id)}><Pin size={13} fill={pinned ? 'currentColor' : 'none'} /></IconButton>
          {extension.hasOptions ? <IconButton label={t('feature.browser.extension.options')} disabled={extensions.busy}
            onClick={() => { void extensions.open(extension.id, 'options').then((opened) => { if (opened) setOpen(false); }); }}><Settings2 size={13} /></IconButton> : null}
          <IconButton label={`${t('feature.browser.extension.remove')} ${extension.name}`} disabled={extensions.busy}
            onClick={() => { void extensions.remove(extension.id); }}><Trash2 size={13} /></IconButton>
        </li>;
      })}</ul> : null}
      <Button variant="ghost" className="browser-extensions__action" disabled={!onOpenSettings} onClick={() => { setOpen(false); onOpenSettings?.(); }}>
        <span>{t('feature.browser.extension.manage')}</span><ArrowUpRight size={14} />
      </Button>
      <Button variant="ghost" className="browser-extensions__action" onClick={() => { setOpen(false); onOpenStore(); }}>
        <span>{t('feature.browser.extension.store')}</span><ArrowUpRight size={14} />
      </Button>
      </>}>
      <Button ref={trigger} variant="ghost" className={`desktop-browser-navigation__button${visible ? ' is-active' : ''}`}
        aria-label={t('feature.browser.extension.label')} title={t('feature.browser.extension.label')}
        disabled={!extensions.available}><BrowserExtensionsIcon /></Button>
    </Popover>
  </span>;
}

function BrowserExtensionIcon({ icon }: { icon: string | null }) {
  return icon ? <img src={icon} alt="" /> : <BrowserExtensionsIcon size={16} />;
}

function BrowserExtensionsIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 5h3v-.5a2.5 2.5 0 0 1 5 0V5h6a1 1 0 0 1 1 1v3h-.5a2.5 2.5 0 0 0 0 5h.5v4a1 1 0 0 1-1 1h-6v.5a2.5 2.5 0 0 1-5 0V19H6a1 1 0 0 1-1-1v-4h-.5a2.5 2.5 0 0 1 0-5H5V6a1 1 0 0 1 1-1Z" />
  </svg>;
}
