import type { SettingsModelPickerProps } from '@setsuna-desktop/renderer-contracts/settings';

/** Keep feature behavior tests independent of the host's menu and provider service. */
export function TestModelPicker({ 'aria-label': label, models, value, disabled, defaultLabel, unavailableLabel, onChange }: SettingsModelPickerProps) {
  const selected = value ? JSON.stringify([value.providerId, value.modelId]) : '';
  const available = models.some((model) => JSON.stringify([model.providerId, model.modelId]) === selected);
  return (
    <select aria-label={label} disabled={disabled} value={selected} onChange={(event) => {
      const model = models.find((option) => JSON.stringify([option.providerId, option.modelId]) === event.currentTarget.value);
      onChange(model ? { providerId: model.providerId, modelId: model.modelId } : null);
    }}>
      <option value="">{defaultLabel}</option>
      {value && !available ? <option value={selected} disabled>{unavailableLabel}</option> : null}
      {models.map((model) => (
        <option key={JSON.stringify([model.providerId, model.modelId])} value={JSON.stringify([model.providerId, model.modelId])}>{model.modelName}</option>
      ))}
    </select>
  );
}
