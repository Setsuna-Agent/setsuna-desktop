import type { ProviderRequestHeaders } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { useId, useState } from 'react';
import { defaultProviderRequestHeaders } from '../contracts/index.js';
import { formatRequestHeaders, parseRequestHeaders } from './request-header-editor.js';

export function ProviderRequestHeadersField({
  catalogProviderId, requestHeaders, onChange, translate, ui,
}: Readonly<{
  catalogProviderId?: string | null;
  requestHeaders?: ProviderRequestHeaders;
  onChange(headers: ProviderRequestHeaders | undefined): void;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const id = useId();
  const source = formatRequestHeaders(requestHeaders ?? defaultProviderRequestHeaders(catalogProviderId));
  // Keep incomplete edits local, and discard them if an external settings update changes the source.
  const [draft, setDraft] = useState<{ source: string; text: string; invalid: boolean } | null>(null);
  const currentDraft = draft?.source === source ? draft : null;
  const invalid = currentDraft?.invalid ?? false;

  return (
    <div className="model-provider-settings__field model-provider-settings__request-headers">
      <div className="model-provider-settings__request-headers-head">
        <label htmlFor={id}>{translate('feature.modelProvider.requestHeaders')}</label>
        <ui.Button
          variant="ghost"
          disabled={requestHeaders === undefined && !currentDraft}
          onClick={() => { setDraft(null); onChange(undefined); }}
        >
          {translate('feature.modelProvider.restoreDefaultHeaders')}
        </ui.Button>
      </div>
      <ui.TextArea
        id={id}
        aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ''}`}
        aria-invalid={invalid}
        autoComplete="off"
        spellCheck={false}
        rows={4}
        value={currentDraft?.text ?? source}
        placeholder="X-Custom-Header: value"
        onChange={(event) => {
          const text = event.currentTarget.value;
          try {
            const headers = parseRequestHeaders(text);
            setDraft({ source: formatRequestHeaders(headers), text, invalid: false });
            onChange(headers);
          } catch {
            setDraft({ source, text, invalid: true });
          }
        }}
        onBlur={() => { if (!invalid) setDraft(null); }}
      />
      <small id={`${id}-help`}>
        {translate('feature.modelProvider.requestHeadersHelp', { session: '{{sessionId}}', version: '{{appVersion}}' })}
      </small>
      {invalid ? <small id={`${id}-error`} role="alert">{translate('feature.modelProvider.invalidRequestHeaders')}</small> : null}
    </div>
  );
}
