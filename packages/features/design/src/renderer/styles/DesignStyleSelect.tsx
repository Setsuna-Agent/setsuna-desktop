import { createContext, useContext } from 'react';
import { Link2 } from 'lucide-react';
import { SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocument, DesignStyle } from '../../contracts/index.js';
import { linkedDesignPath } from '../components/design-library-resources.js';

export const DesignStyleContext = createContext<Pick<DesignDocument, 'styles' | 'libraries'>>({});

export function DesignStyleSelect({ kind, value, disabled, compact, onChange, translate: t }: Readonly<{
  kind: DesignStyle['kind']; value?: string; disabled: boolean; compact?: boolean;
  onChange(id: string | undefined, style: DesignStyle | undefined): void;
  translate: RendererTranslate;
}>) {
  const catalog = useContext(DesignStyleContext);
  const choices = Object.entries(catalog.styles ?? {}).flatMap(([id, style]) => {
    if (style.kind !== kind) return [];
    const path = linkedDesignPath(catalog, id);
    return [{ id, style, label: path ? `${style.name} · ${path}` : style.name }];
  });
  if (!choices.length && !value) return null;
  const label = t(kind === 'color' ? 'feature.design.colorStyle' : 'feature.design.textStyle');
  const chosen = choices.find(({ id }) => id === value);
  const missing = value && !chosen;
  const title = chosen ? `${label} · ${chosen.label}` : label;
  return <SelectField aria-label={title} title={title} value={value ?? ''} disabled={disabled}
    className={compact ? `design-style-select--icon${value ? ' is-linked' : ''}` : undefined}
    valueContent={compact ? <Link2 size={14} aria-hidden="true" /> : undefined}
    onValueChange={(id) => onChange(id || undefined, choices.find((choice) => choice.id === id)?.style)}>
    <option value="">{t('feature.design.localStyle')}</option>
    {missing ? <option value={value} disabled>{t('feature.design.unavailableStyle')}</option> : null}
    {choices.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
  </SelectField>;
}
