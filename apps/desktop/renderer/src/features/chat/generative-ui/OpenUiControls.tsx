import { useIsStreaming, useStateField, type ComponentRenderer, type ElementNode } from '@openuidev/react-lang';
import { FormControl, Hint, Input, Label, TextArea } from '@openuidev/react-ui';
import { createContext, useContext } from 'react';

export const OpenUiControlScope = createContext('');
const controlId = (scope: string, name: string) => `${scope}-field-${encodeURIComponent(name)}`;

// The presentation catalog has no Form. Keep local state bindings while giving
// text controls and their labels block-specific DOM identities.
function textControl(multiline: boolean): ComponentRenderer {
  return function ScopedTextControl({ props }) {
    const scope = useContext(OpenUiControlScope);
    const disabled = useIsStreaming();
    const field = useStateField(props.name as string, props.value);
    const shared = {
      id: controlId(scope, field.name),
      name: field.name,
      placeholder: (props.placeholder as string) || '',
      value: (field.value as string | undefined) ?? '',
      disabled,
    };
    return multiline
      ? <TextArea {...shared} rows={(props.rows as number) || 3} onChange={(event) => field.setValue(event.target.value)} />
      : <Input {...shared} type={(props.type as string) || 'text'} onChange={(event) => field.setValue(event.target.value)} />;
  };
}

const ScopedFormControl: ComponentRenderer = ({ props, renderNode }) => {
  const scope = useContext(OpenUiControlScope);
  const input = props.input as ElementNode | undefined;
  const name = input?.type === 'element' ? input.props.name : undefined;
  const rules = input?.props.rules as { required?: boolean } | undefined;
  return <FormControl>
    <Label className="text-sm font-medium" required={rules?.required === true}
      htmlFor={typeof name === 'string' ? controlId(scope, name) : undefined}>{props.label as string}</Label>
    {renderNode(props.input)}
    {props.hint ? <Hint>{props.hint as string}</Hint> : null}
  </FormControl>;
};

const controls: Record<string, ComponentRenderer> = {
  Input: textControl(false),
  TextArea: textControl(true),
  FormControl: ScopedFormControl,
};

export function withScopedOpenUiControls(name: string, Render: ComponentRenderer): ComponentRenderer {
  return controls[name] ?? Render;
}
