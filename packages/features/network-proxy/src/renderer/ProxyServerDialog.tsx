import type {
  DesktopNetworkProxyServerInput,
  DesktopNetworkProxyServerState,
  } from '@setsuna-desktop/contracts';
import type { RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { KeyRound, Server } from 'lucide-react';
import {
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

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
  translate: RendererTranslate;
  ui: SettingsViewUi;
  onClose: () => void;
  onSave: (input: DesktopNetworkProxyServerInput) => Promise<void>;
};

export function ProxyServerDialog({
  busy,
  server,
  translate,
  ui,
  onClose,
  onSave,
}: ProxyServerDialogProps) {
  const { Button, Checkbox, Dialog, TextField } = ui;
  const formId = useId();
  const [draft, setDraft] = useState<ProxyDraft>(() => server ? draftFromServer(server) : emptyDraft());
  const [clearCredentials, setClearCredentials] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const disabled = busy || submitting;

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

  return (
    <Dialog
      className="settings-network-proxy-dialog"
      closeLabel={translate('feature.networkProxy.common.close')}
      footer={(
        <>
          <Button type="button" disabled={disabled} onClick={onClose}>
            {translate('feature.networkProxy.common.cancel')}
          </Button>
          <Button form={formId} type="submit" variant="primary" disabled={disabled}>
            {disabled
              ? translate('feature.networkProxy.common.processing')
              : translate('feature.networkProxy.common.save')}
          </Button>
        </>
      )}
      size="medium"
      subtitle={translate('feature.networkProxy.settings.editorDescription')}
      title={server
        ? translate('feature.networkProxy.settings.editServer')
        : translate('feature.networkProxy.settings.newServer')}
      titleIcon={<Server size={16} />}
      onClose={() => {
        if (!disabled) onClose();
      }}
    >
      <form
        id={formId}
        className="settings-network-proxy-dialog__form"
        aria-busy={disabled}
        onSubmit={(event) => void submit(event)}
      >
        <div className="settings-network-proxy-dialog__fields">
          <ProxyField label={translate('feature.networkProxy.settings.name')}>
            <TextField
              autoFocus
              disabled={disabled}
              required
              value={draft.name}
              placeholder={translate('feature.networkProxy.settings.namePlaceholder')}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </ProxyField>
          <ProxyField label={translate('feature.networkProxy.settings.url')}>
            <TextField
              disabled={disabled}
              required
              spellCheck={false}
              value={draft.url}
              placeholder={translate('feature.networkProxy.settings.urlHelp')}
              onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
            />
          </ProxyField>
          <ProxyField label={translate('feature.networkProxy.settings.username')}>
            <TextField
              autoComplete="off"
              disabled={disabled || clearCredentials}
              value={clearCredentials ? '' : draft.username}
              placeholder={translate('feature.networkProxy.settings.credentialsOptional')}
              onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
            />
          </ProxyField>
          <ProxyField label={translate('feature.networkProxy.settings.password')}>
            <TextField
              autoComplete="new-password"
              disabled={disabled || clearCredentials}
              type="password"
              value={clearCredentials ? '' : draft.password}
              placeholder={draft.passwordSet
                ? translate('feature.networkProxy.settings.keepPassword')
                : translate('feature.networkProxy.settings.credentialsOptional')}
              onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
            />
          </ProxyField>
        </div>

        {draft.passwordSet || draft.username ? (
          <Checkbox
            checked={clearCredentials}
            className="settings-network-proxy-dialog__clear-credentials"
            disabled={disabled}
            onChange={setClearCredentials}
          >
            <KeyRound size={13} />
            <span>{translate('feature.networkProxy.settings.clearCredentials')}</span>
          </Checkbox>
        ) : null}

        {actionError ? (
          <div className="settings-network-proxy-dialog__error" role="alert">{actionError}</div>
        ) : null}
      </form>
    </Dialog>
  );
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
