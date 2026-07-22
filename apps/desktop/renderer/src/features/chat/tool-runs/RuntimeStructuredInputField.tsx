import type {
  RuntimeStructuredInputField as RuntimeStructuredInputFieldSchema,
  RuntimeStructuredInputValue,
} from '@setsuna-desktop/contracts';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

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
  const label = field.title || name;
  const choices: Array<{ const: string; title: string; description?: string }> | undefined = field.oneOf
    ?? field.enum?.map((item, index) => ({ const: item, title: field.enumNames?.[index] ?? item }));
  const arrayChoices: Array<{ const: string; title: string; description?: string }> | undefined = field.items?.anyOf
    ?? field.items?.enum?.map((item) => ({ const: item, title: item }));
  const selectedDescriptions = (field.type === 'array' ? arrayChoices : choices)
    ?.filter((choice) => Array.isArray(value) ? value.includes(choice.const) : value === choice.const)
    .map((choice) => choice.description)
    .filter((description): description is string => Boolean(description));

  return (
    <label className={`chat-tool-run__elicitation-field${field.type === 'boolean' ? ' chat-tool-run__elicitation-field--boolean' : ''}`}>
      <span>{label}{required ? <em>{t('toolRun.input.required')}</em> : null}</span>
      {field.description ? <small>{field.description}</small> : null}
      {field.type === 'boolean' ? (
        <input name={name} type="checkbox" checked={value === true} onChange={(event) => onChange(event.currentTarget.checked)} />
      ) : field.type === 'number' || field.type === 'integer' ? (
        <input
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
        <select
          name={name}
          multiple
          required={required}
          value={Array.isArray(value) ? value : []}
          onChange={(event) => onChange([...event.currentTarget.selectedOptions].map((option) => option.value))}
        >
          {(arrayChoices ?? []).map((choice) => <option key={choice.const} value={choice.const}>{choice.title}</option>)}
        </select>
      ) : choices?.length ? (
        <select name={name} required={required} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.currentTarget.value)}>
          <option value="" disabled={required}>{t(required ? 'toolRun.input.choose' : 'toolRun.input.notSelected')}</option>
          {choices.map((choice) => <option key={choice.const} value={choice.const}>{choice.title}</option>)}
        </select>
      ) : field.multiline ? (
        <textarea
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
    </label>
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
