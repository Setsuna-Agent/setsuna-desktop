import { Diamond, Plus, Unlink2 } from 'lucide-react';
import { Button, SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { InspectorField } from '../inspector/DesignInspectorFields.js';

export type ComponentActions = Readonly<{
  canCreate: boolean;
  sourceId?: string;
  librarySource?: boolean;
  library: readonly { id: string; name: string }[];
  onCreate(): void;
  onInsert(id: string): Promise<boolean>;
  onLocate?: (id: string) => void;
  onDetach?: () => void;
  variant?: Readonly<{
    instanceId: string;
    value: string;
    items: readonly { id: string; name: string }[];
    select(id: string): void;
    preview(id: string | undefined, owner: string): void;
  }>;
  definition?: Readonly<{ name: string; onRename(name: string): Promise<boolean>; add(): void }>;
}>;

export function DesignComponentActions({ sourceId, library, librarySource, onInsert, onLocate, onDetach, variant, definition, disabled, translate: t }: Omit<ComponentActions, 'canCreate' | 'onCreate'> & Readonly<{
  disabled: boolean;
  translate: RendererTranslate;
}>) {
  if (!sourceId && !library.length) return null;
  const insertLabel = t('feature.design.insertComponent');
  return <div className="design-inspector__component-actions">
    {definition ? <>
      <InspectorField label={t('feature.design.variant')} value={definition.name} placeholder={t('feature.design.variant.default')}
        maxLength={128} readOnly={disabled} onSave={definition.onRename} />
      <Button size="small" variant="ghost" icon={<Plus size={14} />} disabled={disabled}
        onClick={definition.add}>{t('feature.design.addVariant')}</Button>
    </> : null}
    {variant && variant.items.length > 1 ? <SelectField key={variant.instanceId} aria-label={t('feature.design.variant')} value={variant.value}
      disabled={disabled || !onDetach} onValueChange={variant.select} onValuePreview={variant.preview}>
      {variant.items.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </SelectField> : null}
    {sourceId ? <div className="design-inspector__pair">
      <Button size="small" variant="ghost" disabled={disabled || !onLocate} icon={<Diamond size={13} />} onClick={() => onLocate?.(sourceId)}>
        {t(librarySource ? 'feature.design.openLibrarySource' : 'feature.design.locateComponent')}
      </Button>
      <Button size="small" variant="ghost" disabled={disabled || !onDetach} icon={<Unlink2 size={13} />} onClick={onDetach}>
        {t('feature.design.detachComponent')}
      </Button>
    </div> : null}
    {library.length ? <SelectField aria-label={insertLabel} title={insertLabel} value="" valueContent={insertLabel}
      disabled={disabled} onValueChange={(id) => { if (id) void onInsert(id); }}>
      {library.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </SelectField> : null}
  </div>;
}
