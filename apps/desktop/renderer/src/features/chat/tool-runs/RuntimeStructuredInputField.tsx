import type {
  RuntimeStructuredInputField as RuntimeStructuredInputFieldSchema,
  RuntimeStructuredInputValue,
} from '@setsuna-desktop/contracts';
import { useId } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Checkbox, SelectField } from '../../../shared/ui/primitives.js';

export function RuntimeStructuredInputField({
  field,
  name,
  onChange,
  required,
  value,
}: {
  field: RuntimeStructuredInputFieldSchema;
  name: string;
  onChange(value: RuntimeStructuredInputValue): void;
  required: boolean;
  value: RuntimeStructuredInputValue | undefined;
}) {
  const { t } = useI18n();
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const label = field.title || name;
  const choices: Array<{ const: string; title: string; description?: string }> | undefined = field.oneOf
    ?? field.enum?.map((item, index) => ({ const: item, title: field.enumNames?.[index] ?? item }));
  const arrayChoices: Array<{ const: string; title: string; description?: string }> | undefined = field.items?.anyOf
    ?? field.items?.enum?.map((item) => ({ const: item, title: item }));
  const selectedArrayValues = Array.isArray(value) ? value : [];
  const selectedDescriptions = choices
    ?.filter((choice) => value === choice.const)
    .map((choice) => choice.description)
    .filter((description): description is string => Boolean(description));

  return (
    <div className={`chat-tool-run__elicitation-field${field.type === 'boolean' ? ' chat-tool-run__elicitation-field--boolean' : ''}`}>
      <label id={labelId} htmlFor={field.type === 'array' ? undefined : fieldId}>{label}{required ? <em>{t('toolRun.input.required')}</em> : null}</label>
      {field.description ? <small>{field.description}</small> : null}
      {field.type === 'boolean' ? (
        <Checkbox
          aria-labelledby={labelId}
          checked={value === true}
          id={fieldId}
          name={name}
          onChange={onChange}
        />
      ) : field.type === 'number' || field.type === 'integer' ? (
        <input
          id={fieldId}
          name={name}
          type="number"
          required={required}
          min={field.minimum}
          max={field.maximum}
          step={field.type === 'integer' ? 1 : 'any'}
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => onChange(event.currentTarget.value === '' ? '' : Number(event.currentTarget.value))}
        />
      ) : field.type === 'array' ? (
        <div
          aria-labelledby={labelId}
          className="chat-tool-run__elicitation-multi-select"
          role="group"
        >
          {(arrayChoices ?? []).map((choice, index) => {
            const checked = selectedArrayValues.includes(choice.const);
            const selectionLimitReached = field.maxItems !== undefined && selectedArrayValues.length >= field.maxItems;
            return (
              <Checkbox
                checked={checked}
                className={`chat-tool-run__elicitation-multi-select-option${checked ? ' is-selected' : ''}`}
                disabled={!checked && selectionLimitReached}
                id={`${fieldId}-${index}`}
                key={choice.const}
                name={name}
                required={required && selectedArrayValues.length === 0 && index === 0}
                value={choice.const}
                onChange={(nextChecked) => onChange(nextChecked
                  ? [...selectedArrayValues, choice.const]
                  : selectedArrayValues.filter((item) => item !== choice.const))}
              >
                <span className="chat-tool-run__elicitation-multi-select-copy">
                  <span>{choice.title}</span>
                  {choice.description ? <small>{choice.description}</small> : null}
                </span>
              </Checkbox>
            );
          })}
        </div>
      ) : choices?.length ? (
        <SelectField
          aria-labelledby={labelId}
          id={fieldId}
          name={name}
          required={required}
          value={typeof value === 'string' ? value : ''}
          onValueChange={onChange}
        >
          <option value="" disabled={required}>{t(required ? 'toolRun.input.choose' : 'toolRun.input.notSelected')}</option>
          {choices.map((choice) => <option key={choice.const} value={choice.const}>{choice.title}</option>)}
        </SelectField>
      ) : field.multiline ? (
        <textarea
          id={fieldId}
          name={name}
          required={required}
          minLength={field.minLength}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      ) : (
        <input
          id={fieldId}
          name={name}
          type={inputType(field.format)}
          required={required}
          minLength={field.minLength}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
      {selectedDescriptions?.length ? <small>{selectedDescriptions.join(t('toolRun.input.descriptionJoiner'))}</small> : null}
    </div>
  );
}

export function structuredInputDefaults(
  fields: Record<string, RuntimeStructuredInputFieldSchema>,
): Record<string, RuntimeStructuredInputValue> {
  return Object.fromEntries(Object.entries(fields).flatMap(([name, field]) =>
    field.default !== undefined
      ? [[name, field.default] as const]
      : field.type === 'boolean'
        ? [[name, false] as const]
        : [],
  ));
}

export function compactStructuredInputValues(
  values: Record<string, RuntimeStructuredInputValue>,
): Record<string, RuntimeStructuredInputValue> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) =>
    value !== '' && (!Array.isArray(value) || value.length > 0),
  ));
}

function inputType(format: RuntimeStructuredInputFieldSchema['format']): 'date' | 'datetime-local' | 'email' | 'text' | 'url' {
  if (format === 'email') return 'email';
  if (format === 'uri') return 'url';
  if (format === 'date') return 'date';
  if (format === 'date-time') return 'datetime-local';
  return 'text';
}
