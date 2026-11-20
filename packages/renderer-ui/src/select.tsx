import { Check, ChevronDown } from 'lucide-react';
import { Select as Primitive } from 'radix-ui';
import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DOMAttributes,
  type OptgroupHTMLAttributes,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { overlayContainer } from './portal.js';

type SelectOption = {
  disabled: boolean;
  label: ReactNode;
  style?: CSSProperties;
  value: string;
};
type SelectEntry = SelectOption | { label?: string; options: SelectOption[] };

export type SelectFieldProps = {
  'aria-label'?: string;
  'aria-labelledby'?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  menuClassName?: string;
  /** Horizontal edge of the trigger the popup lines up with (default: end). */
  menuAlign?: 'start' | 'end';
  menuMinWidth?: number;
  name?: string;
  onValueChange: (value: string) => boolean | void;
  /** Temporarily preview a hovered option. An undefined value clears this owner's preview. */
  onValuePreview?: (value: string | undefined, owner: string) => void;
  renderOptionIcon?: (value: string) => ReactNode;
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
  menuAlign = 'end',
  menuMinWidth,
  name,
  onValueChange,
  onValuePreview,
  renderOptionIcon,
  required = false,
  style,
  title,
  value,
  valueContent,
}: SelectFieldProps) {
  const { entries, options } = useMemo(() => {
    const entries = selectEntries(children);
    return { entries, options: entries.flatMap((entry) => 'options' in entry ? entry.options : [entry]) };
  }, [children]);
  const selectedOption = options.find((option) => option.value === value) ?? options.find((option) => !option.disabled) ?? null;
  // 只在当前选中项确实有图标时才给触发器留出图标位，避免“全部”之类无图标选项前出现空白。
  const selectedIcon = renderOptionIcon && selectedOption ? renderOptionIcon(selectedOption.value) : null;
  const restoreFocus = useRef(true);
  const [open, setOpen] = useState(false);
  const preview = useHoverPreview(open && !disabled ? onValuePreview : undefined);
  const onOpenChange = (next: boolean) => {
    if (next && (disabled || options.length === 0)) return;
    if (next) restoreFocus.current = true;
    else preview.clear();
    setOpen(next);
  };
  function renderOption(option: SelectOption, index: number) {
    return <Primitive.Item key={`${option.value}:${index}`} value={`${OPTION_VALUE_PREFIX}${option.value}`}
      {...(!option.disabled && option.value !== value ? preview.option(() => option.value) : undefined)}
      className={`sd-select-menu__option${renderOptionIcon ? ' sd-select-menu__option--with-icon' : ''}`} disabled={option.disabled} style={option.style}>
      {/* Keep decorative glyphs out of the text used for keyboard typeahead. */}
      {renderOptionIcon ? <span className="sd-select-field__icon" aria-hidden="true">{renderOptionIcon(option.value)}</span> : null}
      <Primitive.ItemText>{option.label}</Primitive.ItemText>
      <Primitive.ItemIndicator asChild><Check size={15} aria-hidden="true" /></Primitive.ItemIndicator>
    </Primitive.Item>;
  }

  return (
    <>
      <Primitive.Root open={open} onOpenChange={onOpenChange} disabled={disabled}
        value={`${OPTION_VALUE_PREFIX}${value}`} onValueChange={(next) => {
          preview.clear();
          restoreFocus.current = onValueChange(next.slice(OPTION_VALUE_PREFIX.length)) !== false;
        }}>
        <Primitive.Trigger
          id={id}
          type="button"
          className={['sd-field', 'sd-select-field', selectedIcon ? 'sd-select-field--with-icon' : '', open ? 'is-open' : '', className].filter(Boolean).join(' ')}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-required={required || undefined}
          disabled={disabled}
          style={style}
          title={title}
        >
          {selectedIcon ? <span className="sd-select-field__icon" aria-hidden="true">{selectedIcon}</span> : null}
          <span className="sd-select-field__value">{valueContent ?? selectedOption?.label ?? ''}</span>
          <ChevronDown className="sd-select-field__chevron" size={15} aria-hidden="true" />
        </Primitive.Trigger>
        <Primitive.Portal container={overlayContainer()}>
          {/* Radix coordinates the nested modal's pointer, scroll and focus scopes. */}
          <Primitive.Content className={`sd-menu-surface sd-select-menu${menuClassName ? ` ${menuClassName}` : ''}`}
            position="popper" side="bottom" align={menuAlign} sideOffset={6} collisionPadding={8}
            aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}
            style={{ ...style, '--sd-select-menu-min-width': `${menuMinWidth ?? 160}px` } as CSSProperties}
            onCloseAutoFocus={(event) => {
              // A selection may open a confirmation dialog that should retain focus.
              if (!restoreFocus.current) event.preventDefault();
            }}>
            <Primitive.Viewport className="sd-select-menu__viewport">
              {entries.map((entry, index) => 'options' in entry ? (
                <Fragment key={index}>
                  {index > 0 ? <Primitive.Separator className="sd-menu__separator" /> : null}
                  <Primitive.Group>
                    <Primitive.Label className="sd-visually-hidden">{entry.label}</Primitive.Label>
                    {entry.options.map(renderOption)}
                  </Primitive.Group>
                </Fragment>
              ) : renderOption(entry, index))}
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

function selectEntries(children: ReactNode): SelectEntry[] {
  return Children.toArray(children).flatMap((child): SelectEntry[] => {
    if (!isValidElement(child)) return [];
    if (child.type === Fragment) return selectEntries(child.props.children as ReactNode);
    if (child.type === 'optgroup') {
      const { label, disabled, children } = (child as ReactElement<OptgroupHTMLAttributes<HTMLOptGroupElement>>).props;
      const options = selectEntries(children).flatMap((entry) => 'options' in entry ? [] : [disabled ? { ...entry, disabled: true } : entry]);
      return options.length ? [{ label, options }] : [];
    }
    if (child.type !== 'option') return [];
    const option = child as ReactElement<OptionHTMLAttributes<HTMLOptionElement>>;
    return [{
      disabled: Boolean(option.props.disabled),
      label: option.props.children,
      style: option.props.style,
      value: String(option.props.value ?? ''),
    }];
  });
}

type PreviewEvents = Pick<DOMAttributes<HTMLElement>, 'onPointerEnter' | 'onPointerLeave'>;
type Hover = { target: HTMLElement; reset?: () => void };

export function useHoverPreview<T>(onPreview?: (value: T | undefined, owner: string) => void) {
  const owner = useId();
  const active = useRef<Hover>();
  const clear = useCallback(() => {
    const previous = active.current;
    active.current = undefined;
    previous?.reset?.();
  }, []);
  useLayoutEffect(() => clear, [clear]);
  useLayoutEffect(() => {
    if (active.current && (!onPreview || !active.current.target.isConnected)) clear();
  });

  function option(read: (target: HTMLElement) => T | undefined | Promise<T | undefined>): PreviewEvents | undefined {
    if (!onPreview) return;
    return {
      onPointerEnter(event) {
        if (event.pointerType === 'touch') return;
        clear();
        const hover: Hover = { target: event.currentTarget };
        active.current = hover;
        const publish = (value: T | undefined) => {
          // An asset can finish loading after the pointer has moved or the menu has closed.
          if (value === undefined || active.current !== hover || !hover.target.isConnected) return;
          hover.reset = () => onPreview(undefined, owner);
          onPreview(value, owner);
        };
        const value = read(hover.target);
        if (value instanceof Promise) void value.then(publish, () => undefined);
        else publish(value);
      },
      onPointerLeave(event) {
        if (active.current?.target === event.currentTarget) clear();
      },
    };
  }

  return { option, clear };
}
