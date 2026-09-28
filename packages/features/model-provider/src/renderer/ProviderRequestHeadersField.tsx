import type { ProviderRequestHeaders } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useRequestHeaderEditor } from './useRequestHeaderEditor.js';

export function ProviderRequestHeadersField({
  catalogProviderId, requestHeaders, onChange, onValidityChange, translate, ui,
}: Readonly<{
  catalogProviderId?: string | null;
  requestHeaders?: ProviderRequestHeaders;
  onChange(headers: ProviderRequestHeaders | undefined): void;
  onValidityChange?(valid: boolean): void;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const id = useId();
  const editor = useRequestHeaderEditor(catalogProviderId, requestHeaders, onChange);
  const [focusRowId, setFocusRowId] = useState<string>();
  const { invalid } = editor;

  useEffect(() => { onValidityChange?.(!invalid); }, [invalid, onValidityChange]);

  return (
    <div className="model-provider-settings__field model-provider-settings__request-headers" role="group" aria-labelledby={id}>
      <div className="model-provider-settings__request-headers-head">
        <span id={id}>{translate('feature.modelProvider.requestHeaders')}</span>
        <div className="model-provider-settings__request-headers-actions">
          <ui.Button variant="ghost" disabled={!editor.canRestore} onClick={editor.restore}>
            {translate('feature.modelProvider.restoreDefaultHeaders')}
          </ui.Button>
          <ui.Button variant="ghost" icon={<Plus size={13} />} onClick={() => setFocusRowId(editor.add())}>
            {translate('feature.modelProvider.addRequestHeader')}
          </ui.Button>
        </div>
      </div>
      {editor.rows.map((row, index) => (
        <div className="model-provider-settings__request-header-row" key={row.id}>
          <ui.TextField
            aria-label={translate('feature.modelProvider.requestHeaderName', { index: index + 1 })}
            aria-describedby={invalid ? `${id}-error` : undefined}
            aria-invalid={invalid}
            autoComplete="off"
            autoFocus={focusRowId === row.id}
            spellCheck={false}
            placeholder={translate('feature.modelProvider.requestHeaderNamePlaceholder')}
            value={row.name}
            onChange={(event) => editor.update(row.id, { name: event.currentTarget.value })}
          />
          <ui.TextField
            aria-label={translate('feature.modelProvider.requestHeaderValue', { index: index + 1 })}
            aria-describedby={invalid ? `${id}-error` : undefined}
            aria-invalid={invalid}
            autoComplete="off"
            spellCheck={false}
            placeholder={translate('feature.modelProvider.requestHeaderValuePlaceholder')}
            value={row.value}
            onChange={(event) => editor.update(row.id, { value: event.currentTarget.value })}
          />
          <ui.Tooltip title={translate('feature.modelProvider.removeRequestHeader', { index: index + 1 })}>
            <ui.IconButton
              label={translate('feature.modelProvider.removeRequestHeader', { index: index + 1 })}
              title=""
              onClick={() => editor.remove(row.id)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </ui.IconButton>
          </ui.Tooltip>
        </div>
      ))}
      {invalid ? <small id={`${id}-error`} role="alert">{translate('feature.modelProvider.invalidRequestHeaders')}</small> : null}
    </div>
  );
}
