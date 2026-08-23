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
