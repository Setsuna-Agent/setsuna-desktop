import { SelectField } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocument } from '../../contracts/index.js';
import type { DesignVariableModeIds } from '../../contracts/design-variable-collections.js';
import { designLibrarySourceLabel, designLibraryVariableCollections, designVariableCollectionLabel, type DesignLibraryResources } from '../components/design-library-resources.js';
import { InspectorSection } from '../inspector/DesignInspectorFields.js';
import { bindDesignValue, type InspectorFieldEdits } from '../inspector/design-inspector-edit.js';

export function DesignBoardModes({ modeIds, document, resources, disabled, fieldEdits, translate: t }: Readonly<{
  modeIds?: DesignVariableModeIds; document: DesignDocument; resources: DesignLibraryResources; disabled: boolean;
  fieldEdits: InspectorFieldEdits; translate: RendererTranslate;
}>) {
  const modeLabel = t('feature.design.variableMode');
  const choices = designLibraryVariableCollections(document, resources).flatMap((entry) => {
    const { key, collection, path } = entry;
    const options = Object.entries(collection.modes ?? {});
    const mode = modeIds && Object.hasOwn(modeIds, key) ? modeIds[key] : '';
    if (!options.length && !mode) return [];
    return [{ key, source: designLibrarySourceLabel(path), options, mode, label: designVariableCollectionLabel(entry, t('feature.design.defaultVariableCollection')),
      defaultLabel: collection.defaultModeName ?? t('feature.design.defaultVariableMode') }];
  });
  if (!choices.length) return null;
  const edits = bindDesignValue(fieldEdits, (current, { key, value }: { key: string; value: string }) => {
    if (current.kind !== 'frame') return current;
    const variableModeIds = { ...current.variableModeIds };
    if (value) variableModeIds[key] = value;
    else delete variableModeIds[key];
    return { ...current, variableModeIds: Object.keys(variableModeIds).length ? variableModeIds : undefined };
  });
  return <InspectorSection title={modeLabel}>
    {choices.map(({ key, source, options, label, mode, defaultLabel }) => {
      return <SelectField key={key} aria-label={label} title={source ? `${label} · ${source}` : label} value={mode} disabled={disabled}
        onValuePreview={(value, owner) => edits.onPreview(value === undefined ? undefined : { key, value }, owner)}
        onValueChange={(value) => { void edits.onSave({ key, value }); }}>
        <option value="">{`${label} · ${defaultLabel}`}</option>
        {mode && !options.some(([id]) => id === mode) ? <option value={mode} disabled>{t('feature.design.unavailableVariableMode')}</option> : null}
        {options.map(([id, name]) => <option key={id} value={id}>{`${label} · ${name}`}</option>)}
      </SelectField>;
    })}
  </InspectorSection>;
}
