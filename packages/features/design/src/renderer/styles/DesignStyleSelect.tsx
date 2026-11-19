import { createContext, useContext } from 'react';
import { Link2 } from 'lucide-react';
import { SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocument, DesignStyle } from '../../contracts/index.js';
import { designResourceParts } from '../../contracts/design-resource-id.js';
import { designVariableCollectionKey } from '../../contracts/design-variable-collections.js';
import { designVariableFieldKind, designVariableFieldValue, type DesignVariableField, type DesignVariableValue } from '../../contracts/design-variables.js';
import { linkedDesignPath } from '../components/design-library-resources.js';
import './design-variable-link.css';

export const DesignStyleContext = createContext<Pick<DesignDocument, 'styles' | 'libraries'> & Readonly<{
  documentId?: string;
  collectionNames?: Readonly<Record<string, string>>;
  openVariables?(): void;
}>>({});

// Resource IDs cannot contain @. This option opens the catalog instead of binding a variable.
const openVariablesOption = '@variables';

export function designColorStyle(styles: DesignDocument['styles'], id: string | undefined) {
  const style = id && styles && Object.hasOwn(styles, id) ? styles[id] : undefined;
  return style?.kind === 'color' ? style : undefined;
}

type StyleFilter = Readonly<{ kind: 'color' | 'text'; field?: never; fieldLabel?: never }>
  | Readonly<{ field: DesignVariableField; fieldLabel: string; kind?: never }>;

export type DesignStyleChoice = Readonly<{ id?: string; style?: DesignStyle }>;

export function DesignStyleSelect({ kind, field, fieldLabel, value, disabled, compact, acceptsValue, onChange, onPreview, translate: t }: StyleFilter & Readonly<{
  value?: string; disabled: boolean; compact?: boolean;
  acceptsValue?(value: DesignVariableValue): boolean;
  onChange(choice: DesignStyleChoice): void;
  onPreview?(choice: DesignStyleChoice | undefined, owner: string): void;
  translate: RendererTranslate;
}>) {
  const catalog = useContext(DesignStyleContext);
  const choices = Object.entries(catalog.styles ?? {}).flatMap(([id, style]) => {
    if (field) {
      const resolved = designVariableFieldValue(field, style);
      if (resolved === undefined || acceptsValue && !acceptsValue(resolved)) return [];
    } else if (style.kind !== kind) return [];
    const path = linkedDesignPath(catalog, id);
    const owner = designResourceParts(id)?.documentId ?? catalog.documentId;
    const key = owner && style.kind !== 'text' ? designVariableCollectionKey(owner, style.collectionId) : undefined;
    const collection = key && catalog.collectionNames && Object.hasOwn(catalog.collectionNames, key) ? catalog.collectionNames[key] : undefined;
    return [{ id, style, label: [collection, style.name, path].filter(Boolean).join(' · ') }];
  });
  const openVariables = !choices.length && field && designVariableFieldKind(field) === 'number' ? catalog.openVariables : undefined;
  if (!choices.length && !value && !openVariables) return null;
  const label = field ? t('feature.design.bindVariable', { field: fieldLabel })
    : t(kind === 'color' ? 'feature.design.colorStyle' : 'feature.design.textStyle');
  const chosen = choices.find(({ id }) => id === value);
  const missing = value && !chosen;
  const title = chosen ? `${label} · ${chosen.label}` : label;
  const choiceFor = (id: string): DesignStyleChoice => ({ id: id || undefined, style: choices.find((choice) => choice.id === id)?.style });
  return <SelectField aria-label={title} title={title} value={value ?? ''} disabled={disabled}
    className={compact ? `design-variable-link${value ? ' is-linked' : ''}` : undefined}
    valueContent={compact ? <Link2 aria-hidden="true" /> : undefined}
    onValuePreview={onPreview && ((id, owner) => onPreview(
      id === undefined || id === openVariablesOption ? undefined : choiceFor(id), owner))}
    onValueChange={(id) => {
      if (id === openVariablesOption) {
        openVariables?.();
        return false;
      }
      onChange(choiceFor(id));
    }}>
    <option value="">{t(kind === 'text' ? 'feature.design.localStyle' : 'feature.design.localValue')}</option>
    {missing ? <option value={value} disabled>{t('feature.design.unavailableStyle')}</option> : null}
    {choices.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
    {openVariables ? <option value={openVariablesOption}>{t('feature.design.openVariables')}</option> : null}
  </SelectField>;
}
