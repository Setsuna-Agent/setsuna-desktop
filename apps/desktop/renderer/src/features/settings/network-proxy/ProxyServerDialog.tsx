import type {
  DesktopNetworkProxyServerInput,
  DesktopNetworkProxyServerState,
} from '@setsuna-desktop/contracts';
import { KeyRound, Server, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button, IconButton, TextField } from '../../../shared/ui/primitives.js';

type ProxyDraft = {
  id?: string;
  name: string;
  password: string;
  passwordSet: boolean;
  url: string;
  username: string;
};

type ProxyServerDialogProps = {
  busy: boolean;
  server?: DesktopNetworkProxyServerState;
  onClose: () => void;
  onSave: (input: DesktopNetworkProxyServerInput) => Promise<void>;
};

export function ProxyServerDialog({ busy, server, onClose, onSave }: ProxyServerDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
  );
  const [draft, setDraft] = useState<ProxyDraft>(() => server ? draftFromServer(server) : emptyDraft());
  const [clearCredentials, setClearCredentials] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const disabled = busy || submitting;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !disabled) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disabled, onClose]);

  useEffect(() => () => previousFocusRef.current?.focus(), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await onSave(inputFromDraft(draft, clearCredentials));
      setSubmitting(false);
      onClose();
    } catch (error) {
      setActionError(errorMessage(error));
      setSubmitting(false);
    }
  };

  const dialog = (
    <div
      className="desktop-agent-modal-backdrop settings-network-proxy-dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!disabled) onClose();
      }}
    >
      <form
        className="desktop-agent-modal settings-network-proxy-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={disabled}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <header className="settings-network-proxy-dialog__header">
          <div className="settings-network-proxy-dialog__title">
            <span aria-hidden="true"><Server size={16} /></span>
            <div>
              <strong id={titleId}>
                {server ? t('settings.proxy.editServer') : t('settings.proxy.newServer')}
              </strong>
              <small id={descriptionId}>{t('settings.proxy.editorDescription')}</small>
            </div>
          </div>
          <IconButton label={t('common.close')} disabled={disabled} onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>

        <div className="settings-network-proxy-dialog__body">
          <div className="settings-network-proxy-dialog__fields">
            <ProxyField label={t('settings.proxy.name')}>
              <TextField
                autoFocus
                disabled={disabled}
                required
                value={draft.name}
                placeholder={t('settings.proxy.namePlaceholder')}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </ProxyField>
            <ProxyField label={t('settings.proxy.url')}>
              <TextField
                disabled={disabled}
                required
                spellCheck={false}
                value={draft.url}
                placeholder={t('settings.proxy.urlHelp')}
                onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
              />
            </ProxyField>
            <ProxyField label={t('settings.proxy.username')}>
              <TextField
                autoComplete="off"
                disabled={disabled || clearCredentials}
                value={clearCredentials ? '' : draft.username}
                placeholder={t('settings.proxy.credentialsOptional')}
                onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
              />
            </ProxyField>
            <ProxyField label={t('settings.proxy.password')}>
              <TextField
                autoComplete="new-password"
                disabled={disabled || clearCredentials}
                type="password"
                value={clearCredentials ? '' : draft.password}
                placeholder={draft.passwordSet
                  ? t('settings.proxy.keepPassword')
                  : t('settings.proxy.credentialsOptional')}
                onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
              />
            </ProxyField>
          </div>

          {draft.passwordSet || draft.username ? (
            <label className="settings-network-proxy-dialog__clear-credentials">
              <input
                checked={clearCredentials}
                disabled={disabled}
                type="checkbox"
                onChange={(event) => setClearCredentials(event.currentTarget.checked)}
              />
              <KeyRound size={13} />
              <span>{t('settings.proxy.clearCredentials')}</span>
            </label>
          ) : null}

          {actionError ? (
            <div className="settings-network-proxy-dialog__error" role="alert">{actionError}</div>
          ) : null}
        </div>

        <footer className="settings-network-proxy-dialog__footer">
          <Button disabled={disabled} onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={disabled}>
            {disabled ? t('common.processing') : t('common.save')}
          </Button>
        </footer>
      </form>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

function ProxyField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="settings-network-proxy-dialog__field">
      <span>
        <strong>{label}</strong>
      </span>
      {children}
    </label>
  );
}

function emptyDraft(): ProxyDraft {
  return { name: '', password: '', passwordSet: false, url: '', username: '' };
}

function draftFromServer(server: DesktopNetworkProxyServerState): ProxyDraft {
  return {
    id: server.id,
    name: server.name,
    password: '',
    passwordSet: server.passwordSet,
    url: server.url,
    username: server.username ?? '',
  };
}

function inputFromDraft(draft: ProxyDraft, clearCredentials: boolean): DesktopNetworkProxyServerInput {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name,
    url: draft.url,
    username: clearCredentials ? '' : draft.username,
    ...(draft.password && !clearCredentials ? { password: draft.password } : {}),
    ...(clearCredentials ? { clearPassword: true } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
