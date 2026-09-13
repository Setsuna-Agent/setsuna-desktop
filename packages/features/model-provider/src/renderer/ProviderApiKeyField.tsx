import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export function ProviderApiKeyField({
  apiKey, apiKeyPreview, apiKeySet, className = '', onChange, onCopy, translate, ui,
}: Readonly<{
  apiKey: string;
  apiKeyPreview: string;
  apiKeySet: boolean;
  className?: string;
  onChange(value: string): void;
  onCopy(): Promise<void>;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const inputId = useId();
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => {
    requestRef.current += 1;
    clearTimeout(timerRef.current);
  }, []);

  const copy = async () => {
    if (status === 'copying') return;
    const request = ++requestRef.current;
    clearTimeout(timerRef.current);
    setStatus('copying');
    try {
      await onCopy();
      // Ignore feedback for a previous input or an editor that has been closed.
      if (request !== requestRef.current) return;
      setStatus('copied');
      timerRef.current = setTimeout(() => setStatus('idle'), 1600);
    } catch {
      if (request === requestRef.current) setStatus('error');
    }
  };
  const copyLabel = translate(status === 'copied'
    ? 'feature.modelProvider.apiKeyCopied'
    : 'feature.modelProvider.copyApiKey');

  return (
    <div className={`model-provider-settings__field ${className}`}>
      <label htmlFor={inputId}>
        {translate('feature.modelProvider.apiKey')}
        {apiKeySet ? <em>{apiKeyPreview}</em> : null}
      </label>
      <div className="model-provider-settings__api-key-input">
        <ui.TextField
          id={inputId}
          autoComplete="off"
          placeholder={translate(apiKeySet ? 'feature.modelProvider.keepApiKey' : 'feature.modelProvider.enterApiKey')}
          type="password"
          value={apiKey}
          onChange={(event) => {
            requestRef.current += 1;
            clearTimeout(timerRef.current);
            setStatus('idle');
            onChange(event.target.value);
          }}
        />
        <ui.Tooltip title={copyLabel}>
          <ui.IconButton
            aria-busy={status === 'copying'}
            className="model-provider-settings__copy-api-key"
            disabled={status === 'copying' || (!apiKey.trim() && !apiKeySet)}
            label={copyLabel}
            title=""
            onClick={() => void copy()}
          >
            {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </ui.IconButton>
        </ui.Tooltip>
      </div>
      {status === 'error' ? <ui.Toast message={translate('feature.modelProvider.copyApiKeyFailed')} tone="error" /> : null}
    </div>
  );
}
