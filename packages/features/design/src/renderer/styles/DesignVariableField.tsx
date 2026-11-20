import { useContext, type ComponentProps, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { bindDesignVariable, designVariableFieldValue, type DesignVariableField as Field,
  type DesignVariableTarget, type DesignVariableValue } from '../../contracts/design-variables.js';
import { NumberField } from '../inspector/DesignInspectorFields.js';
import { DesignNumberSliderField } from '../inspector/DesignNumberSliderField.js';
import { DesignStyleContext, DesignStyleSelect, type DesignStyleChoice } from './DesignStyleSelect.js';

type Binding<T> = Readonly<{
  target: T;
  field: Field;
  disabled: boolean;
  acceptsValue?(value: DesignVariableValue): boolean;
  onBind(target: T): Promise<boolean>;
  onBindPreview?(target: T | undefined, owner: string): void;
  translate: RendererTranslate;
}>;

export function DesignVariableField<T extends DesignVariableTarget>({ target, field, label, disabled, acceptsValue, onBind, onBindPreview, translate, children }:
  Binding<T> & Readonly<{ label: string; children(value: DesignVariableValue | undefined, linked: boolean): ReactNode }>,
) {
  const { styles } = useContext(DesignStyleContext);
  const id = target.variableIds?.[field];
  const resolved = designVariableFieldValue(field, id && styles && Object.hasOwn(styles, id) ? styles[id] : undefined);
  const link = ({ id, style }: DesignStyleChoice) =>
    bindDesignVariable(target, field, id, designVariableFieldValue(field, style) ?? resolved);
  return <div className="design-variable-control">
    {children(resolved, Boolean(id))}
    <DesignStyleSelect field={field} fieldLabel={label} value={id} disabled={disabled} acceptsValue={acceptsValue} compact translate={translate}
      onPreview={onBindPreview && ((choice, owner) => onBindPreview(choice && link(choice), owner))}
      onChange={(choice) => { if (choice.id !== id) void onBind(link(choice)); }} />
  </div>;
}

export function VariableNumberField<T extends DesignVariableTarget>({
  target, field, disabled, acceptsValue, onBind, onBindPreview, translate, factor = 1, sliderMax, ...fieldProps
}: Binding<T> & ComponentProps<typeof NumberField> & Readonly<{ factor?: number; sliderMax?: number }>) {
  return <DesignVariableField target={target} field={field} label={fieldProps.label} disabled={disabled || Boolean(fieldProps.readOnly)}
    acceptsValue={acceptsValue} onBind={onBind} onBindPreview={onBindPreview} translate={translate}>
    {(value, linked) => {
      const props = { ...fieldProps, value: typeof value === 'number' ? value * factor : fieldProps.value,
        readOnly: disabled || fieldProps.readOnly || linked };
      return sliderMax === undefined ? <NumberField {...props} /> : <DesignNumberSliderField {...props} sliderMax={sliderMax} />;
    }}
  </DesignVariableField>;
}
