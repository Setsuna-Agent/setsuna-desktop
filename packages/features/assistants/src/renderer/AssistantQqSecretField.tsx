import { useId } from 'react';
import { IconButton, TextField, Tooltip } from '@setsuna-desktop/renderer-ui';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { useAssistantQqSecret, type AssistantQqSecretOptions } from './useAssistantQqSecret.js';

export function AssistantQqSecretField({ disabled, ...options }: AssistantQqSecretOptions & { disabled: boolean }) {
  const inputId = useId();
  const secret = useAssistantQqSecret(options);
  const { translate: t } = options;
  const unavailable = disabled || secret.action !== null || (!options.value.trim() && !options.configured);
  const revealLabel = t(secret.revealed ? 'feature.assistants.qqSecretHide' : 'feature.assistants.qqSecretShow');
  const copyLabel = t(secret.copied ? 'feature.assistants.qqSecretCopied' : 'feature.assistants.qqSecretCopy');
  return <div className="sd-form-field">
    <label className="sd-form-label" htmlFor={inputId}>{t('feature.assistants.qqSecret')}</label>
    <div className="assistant-form__secret">
      <TextField id={inputId} disabled={disabled} type={secret.revealed ? 'text' : 'password'}
        autoComplete="off" spellCheck={false} maxLength={256} value={secret.inputValue}
        placeholder={options.configured ? t('feature.assistants.qqSecretConfigured') : ''}
        onChange={(event) => secret.change(event.target.value)} />
      <div className="assistant-form__secret-actions">
        <Tooltip title={revealLabel}>
          <IconButton className="assistant-form__secret-action" label={revealLabel} title="" disabled={unavailable}
            aria-busy={secret.action === 'reveal'} onClick={secret.toggle}>
            {secret.revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconButton>
        </Tooltip>
        <Tooltip title={copyLabel}>
          <IconButton className="assistant-form__secret-action" label={copyLabel} title="" disabled={unavailable}
            aria-busy={secret.action === 'copy'} onClick={secret.copy}>
            {secret.copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
        </Tooltip>
      </div>
    </div>
  </div>;
}
