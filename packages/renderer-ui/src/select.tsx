import { Check, ChevronDown } from 'lucide-react';
import { Select as Primitive } from 'radix-ui';
import {
  Children,
  Fragment,
  isValidElement,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { overlayContainer } from './portal.js';

type SelectOption = {
  disabled: boolean;
  label: ReactNode;
  value: string;
};

type SelectFieldProps = {
  'aria-label'?: string;
  'aria-labelledby'?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  menuClassName?: string;
  menuMinWidth?: number;
  name?: string;
  onValueChange: (value: string) => boolean | void;
  required?: boolean;
  style?: CSSProperties;
  title?: string;
  value: string;
  valueContent?: ReactNode;
};

// Radix reserves an empty value for its placeholder; prefix every value so that
// domain options such as “follow the current model” can still use an empty string.
const OPTION_VALUE_PREFIX = 'option:';

export function SelectField({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  children,
  className = '',
  disabled = false,
  id,
  menuClassName = '',
  menuMinWidth,
  name,
  onValueChange,
  required = false,
  style,
  title,
  value,
  valueContent,
}: SelectFieldProps) {
  const options = useMemo(() => optionElements(children), [children]);
  const selectedOption = options.find((option) => option.value === value) ?? options.find((option) => !option.disabled) ?? null;
  const restoreFocus = useRef(true);
  const [open, setOpen] = useState(false);
  const onOpenChange = (next: boolean) => {
    if (next && (disabled || options.length === 0)) return;
    if (next) restoreFocus.current = true;
    setOpen(next);
  };

  return (
    <>
      <Primitive.Root open={open} onOpenChange={onOpenChange} disabled={disabled}
        value={`${OPTION_VALUE_PREFIX}${value}`} onValueChange={(next) => {
          restoreFocus.current = onValueChange(next.slice(OPTION_VALUE_PREFIX.length)) !== false;
        }}>
        <Primitive.Trigger
          id={id}
          type="button"
          className={['sd-field', 'sd-select-field', open ? 'is-open' : '', className].filter(Boolean).join(' ')}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-required={required || undefined}
          disabled={disabled}
          style={style}
          title={title}
        >
          <span className="sd-select-field__value">{valueContent ?? selectedOption?.label ?? ''}</span>
          <ChevronDown className="sd-select-field__chevron" size={15} aria-hidden="true" />
        </Primitive.Trigger>
        <Primitive.Portal container={overlayContainer()}>
          {/* Radix coordinates the nested modal's pointer, scroll and focus scopes. */}
          <Primitive.Content className={`sd-select-menu${menuClassName ? ` ${menuClassName}` : ''}`}
            position="popper" align="start" sideOffset={6} collisionPadding={8}
            aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}
            style={{ ...style, '--sd-select-menu-min-width': `${menuMinWidth ?? 160}px` } as CSSProperties}
            onCloseAutoFocus={(event) => {
              // A selection may open a confirmation dialog that should retain focus.
              if (!restoreFocus.current) event.preventDefault();
            }}>
            <Primitive.Viewport className="sd-select-menu__viewport">
              {options.map((option, index) => (
                <Primitive.Item key={`${option.value}:${index}`} value={`${OPTION_VALUE_PREFIX}${option.value}`}
                  className="sd-select-menu__option" disabled={option.disabled}>
                  <Primitive.ItemText>{option.label}</Primitive.ItemText>
                  <Primitive.ItemIndicator asChild><Check size={15} aria-hidden="true" /></Primitive.ItemIndicator>
                </Primitive.Item>
              ))}
            </Primitive.Viewport>
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
      {name || required ? (
        <select
          className="sd-select-field__form-control"
          aria-hidden="true"
          disabled={disabled}
          name={name}
          required={required}
          tabIndex={-1}
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onInvalid={(event) => {
            // Preserve native form validation while presenting the project listbox UI.
            event.preventDefault();
            const firstInvalidControl = event.currentTarget.form?.querySelector(':invalid');
            if (firstInvalidControl !== event.currentTarget) return;
            onOpenChange(true);
          }}
        >
          {options.map((option, index) => (
            <option key={`${option.value}:${index}`} disabled={option.disabled} value={option.value}>
              {option.value}
            </option>
          ))}
        </select>
      ) : null}
    </>
  );
}

function optionElements(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child): SelectOption[] => {
    if (!isValidElement(child)) return [];
    if (child.type === Fragment) return optionElements(child.props.children as ReactNode);
    if (child.type !== 'option') return [];
    const option = child as ReactElement<OptionHTMLAttributes<HTMLOptionElement>>;
    return [{
      disabled: Boolean(option.props.disabled),
      label: option.props.children,
      value: String(option.props.value ?? ''),
    }];
  });
}
