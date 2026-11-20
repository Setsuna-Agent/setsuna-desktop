import { Hash } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Checkbox } from '@setsuna-desktop/renderer-ui';
import { designColorWithAlpha, splitDesignColor } from '../../contracts/design-color.js';
import {
  designScriptParameterValue, maxDesignScriptParameterLength, type DesignScriptInputs, type DesignScriptParameter, type DesignScriptValue,
} from '../../contracts/design-script-parameters.js';
import { InspectorField, InspectorTextArea, NumberField } from './DesignInspectorFields.js';
import { ColorField } from './DesignPaintField.js';

export type DesignScriptParameterEdits = Readonly<{
  parameters: readonly DesignScriptParameter[];
  onSave(parameter: DesignScriptParameter, value: DesignScriptValue): Promise<boolean>;
  onPreview(parameter: DesignScriptParameter, value: DesignScriptValue | undefined, owner: string): void;
}>;

export function DesignScriptParameterFields({ inputs, disabled, translate, ...edits }: DesignScriptParameterEdits & Readonly<{
  inputs?: DesignScriptInputs;
  disabled: boolean;
  translate: RendererTranslate;
}>) {
  return <>{edits.parameters.map((parameter) => <ParameterField key={`${parameter.name}:${parameter.type}`} parameter={parameter}
    value={designScriptParameterValue(parameter, inputs)} disabled={disabled} translate={translate}
    onSave={(value) => edits.onSave(parameter, value)} onPreview={(value, owner) => edits.onPreview(parameter, value, owner)} />)}</>;
}

function ParameterField({ parameter, value, disabled, onSave, onPreview, translate: t }: Readonly<{
  parameter: DesignScriptParameter;
  value: DesignScriptValue;
  disabled: boolean;
  onSave(value: DesignScriptValue): Promise<boolean>;
  onPreview(value: DesignScriptValue | undefined, owner: string): void;
  translate: RendererTranslate;
}>) {
  const owner = useId();
  const label = parameter.name;
  const multiline = parameter.type === 'string' && typeof parameter.defaultValue === 'string'
    && (parameter.defaultValue.length >= 40 || parameter.defaultValue.includes('\n'));
  const textProps = { readOnly: disabled, maxLength: maxDesignScriptParameterLength, spellCheck: false, onSave, onDraft: onPreview };
  let field: ReactNode;
  if (typeof value === 'number') {
    field = <InspectorField label={label} prefix={<Hash size={12} />} type="number" step="any"
      value={String(value)} readOnly={disabled} onDraft={(text, owner) => onPreview(parseNumber(text), owner)} onSave={(text) => {
        const next = parseNumber(text);
        return next === undefined ? Promise.resolve(false) : onSave(next);
      }} />;
  } else if (typeof value === 'boolean') {
    field = <Checkbox aria-label={label} checked={value} disabled={disabled} onChange={(checked) => { void onSave(checked); }} />;
  } else if (parameter.type === 'color') {
    field = <ColorField label={label} value={value}
      disabled={disabled} onSave={onSave} onPreview={(color) => onPreview(color, owner)} editOpacity
      opacityField={<NumberField label={`${label} ${t('feature.design.opacity')}`} suffix="%" min={0} max={100}
        value={Math.round(splitDesignColor(value).opacity * 100)} readOnly={disabled}
        onSave={(opacity) => onSave(designColorWithAlpha(value, opacity / 100))}
        onPreview={(opacity, owner) => onPreview(opacity === undefined ? undefined : designColorWithAlpha(value, opacity / 100), owner)} />} />;
  } else {
    field = multiline ? <InspectorTextArea {...textProps} aria-label={label} value={value} rows={3} />
      : <InspectorField {...textProps} label={label} value={value} />;
  }
  return <div className="design-inspector__script-parameter" data-multiline={multiline || undefined}>
    <span aria-hidden="true" title={label}>{label}</span>
    {field}
  </div>;
}

function parseNumber(value: string | undefined) {
  const number = Number(value);
  return value?.trim() && Number.isFinite(number) ? number : undefined;
}
