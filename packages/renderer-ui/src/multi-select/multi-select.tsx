import { ChevronDown } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { TextField } from '../fields.js';
import { Popover } from '../popover.js';
import { Checkbox } from '../selection-controls.js';
import { cn } from '../utils.js';

export type MultiSelectOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  searchText?: string;
  disabled?: boolean;
};

export type MultiSelectFieldProps = {
  'aria-label': string;
  'aria-describedby'?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  options: readonly MultiSelectOption[];
  value: readonly string[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  onValueChange(value: string[]): void;
};

/** Search filters the choices, never the selected values owned by the form. */
export function MultiSelectField({
  'aria-label': label, 'aria-describedby': describedBy, id, className, disabled = false, options, value,
  placeholder, searchPlaceholder, emptyLabel, onValueChange,
}: MultiSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = new Set(value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleOptions = options.filter((option) =>
    `${option.label} ${option.value} ${option.searchText ?? ''}`.toLocaleLowerCase().includes(normalizedQuery));
  const labels = new Map(options.map((option) => [option.value, option.label]));
  const selectedLabels = value.map((item) => labels.get(item) ?? item);
  const selectedIcon = options.find((option) => option.value === value[0])?.icon;
  const changeOpen = (next: boolean) => {
    setOpen(next && !disabled);
    if (!next) setQuery('');
  };
  useEffect(() => {
    if (disabled) { setOpen(false); setQuery(''); }
  }, [disabled]);

  return <Popover modal open={open} onOpenChange={changeOpen} placement="bottomRight" contentLabel={label}
    className="sd-menu-surface sd-multi-select-menu" content={
      <div className="sd-multi-select-menu__body" onKeyDown={moveOptionFocus}>
        <TextField aria-label={searchPlaceholder} placeholder={searchPlaceholder} disabled={disabled}
          value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <div key={normalizedQuery} className="sd-multi-select-menu__options">
          {visibleOptions.length ? visibleOptions.map((option) => (
            <Checkbox key={option.value} className="sd-multi-select-menu__option"
              checked={selected.has(option.value)} disabled={disabled || option.disabled}
              onChange={(checked) => {
                if (disabled || option.disabled) return;
                onValueChange(checked ? [...value, option.value] : value.filter((item) => item !== option.value));
              }}>
              {option.icon ? <span className="sd-multi-select-field__icon" aria-hidden="true">{option.icon}</span> : null}
              <span title={option.label}>{option.label}</span>
            </Checkbox>
          )) : <span className="sd-multi-select-menu__empty" role="status">{emptyLabel}</span>}
        </div>
      </div>
    }>
    <button type="button" id={id} aria-label={label} aria-describedby={describedBy} disabled={disabled} title={selectedLabels.join(', ')}
      className={cn('sd-field sd-select-field', open && 'is-open', className)}>
      <span className="sd-multi-select-field__value">
        {selectedIcon ? <span className="sd-multi-select-field__icon" aria-hidden="true">{selectedIcon}</span> : null}
        <span className="sd-select-field__value">{selectedLabels[0] ?? placeholder}</span>
        {value.length > 1 ? <span className="sd-multi-select-field__count">+{value.length - 1}</span> : null}
      </span>
      <ChevronDown className="sd-select-field__chevron" size={15} aria-hidden="true" />
    </button>
  </Popover>;
}

function moveOptionFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input:not(:disabled)'));
  const index = controls.indexOf(event.target as HTMLInputElement);
  if (index < 0) return;
  event.preventDefault();
  // Search joins the keyboard loop; Space toggles each native checkbox without closing.
  controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length]?.focus();
}
