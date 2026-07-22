import type { MouseEvent, ReactNode } from 'react';

export type SettingsChoiceOption<TValue extends string> = {
  value: TValue;
  label: string;
  icon: ReactNode;
};

export function SettingsChoiceGroup<TValue extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: Array<SettingsChoiceOption<TValue>>;
  value: TValue;
  onChange: (value: TValue, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="chat-user-settings__option-group" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            className={`chat-user-settings__option-button ${selected ? 'is-active' : ''}`}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={(event) => onChange(option.value, event)}
          >
            <span className="chat-user-settings__option-icon">{option.icon}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function MemorySettingToggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="chat-user-settings__row chat-user-settings__local-enable-row chat-user-settings__memory-toggle-row">
      <span className="chat-user-settings__row-label chat-user-settings__memory-toggle-label">
        <span className="chat-user-settings__memory-toggle-copy">
          <span>{label}</span>
          <small>{description}</small>
        </span>
      </span>
      <label className="sd-check" title={label}>
        <input
          aria-label={label}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      </label>
    </div>
  );
}
