import { Button } from '@setsuna-desktop/renderer-ui';
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
      {options.map((option, index) => {
        const selected = value === option.value;
        return (
          <Button variant="ghost"
            key={option.value}
            className={`chat-user-settings__option-button ${selected ? 'is-active' : ''}`}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (index === 0 && !options.some((item) => item.value === value)) ? 0 : -1}
            onClick={(event) => onChange(option.value, event)}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % options.length
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + options.length - 1) % options.length : null;
              if (next === null) return;
              event.preventDefault();
              const button = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next];
              button?.focus();
              // Keep keyboard selection on the same change/transition path as a click.
              button?.click();
            }}
          >
            <span className="chat-user-settings__option-icon">{option.icon}</span>
            <span>{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
