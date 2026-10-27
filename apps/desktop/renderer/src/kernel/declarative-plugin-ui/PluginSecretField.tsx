import type { RuntimePluginUiFieldNode } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, TextField, Tooltip } from '@setsuna-desktop/renderer-ui';
import { X } from 'lucide-react';
import { useId } from 'react';

export function PluginSecretField({ field, configured, change, disabled, onChange, translate }: Readonly<{
  field: RuntimePluginUiFieldNode;
  configured: boolean;
  change: string | null | undefined;
  disabled: boolean;
  onChange(value: string | null): void;
  translate: RendererTranslate;
}>) {
  const id = useId();
  const retained = configured && change !== null;
  const clearLabel = translate('feature.pluginManagement.rendererUi.clearSecret', { name: field.label });
  return (
    <div className="declarative-plugin-ui__field">
      <label htmlFor={id}>{field.label}</label>
      <div className="declarative-plugin-ui__secret-input">
        <TextField
          id={id}
          autoComplete="new-password"
          disabled={disabled}
          maxLength={field.maxLength}
          placeholder={retained ? '••••••••' : field.placeholder}
          required={field.required && !retained}
          type="password"
          value={change ?? ''}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <Tooltip title={clearLabel}>
          <IconButton
            disabled={disabled || (!change && !retained)}
            label={clearLabel}
            title=""
            onClick={() => onChange(null)}
          >
            <X size={14} aria-hidden="true" />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
