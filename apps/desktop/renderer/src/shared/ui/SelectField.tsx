import { Check, ChevronDown } from 'lucide-react';
import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type SelectOption = {
  disabled: boolean;
  label: ReactNode;
  value: string;
};

type SelectFieldProps = {
  'aria-label'?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  onValueChange: (value: string) => void;
  style?: CSSProperties;
  title?: string;
  value: string;
};

export type SelectMenuPosition = {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
};

type SelectMenuViewport = {
  height: number;
  scaleInverse?: number;
  width: number;
};

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 280;
const VIEWPORT_GUTTER = 8;

export function SelectField({
  'aria-label': ariaLabel,
  children,
  className = '',
  disabled = false,
  id,
  onValueChange,
  style,
  title,
  value,
}: SelectFieldProps) {
  const options = useMemo(() => optionElements(children), [children]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = options[selectedIndex] ?? options.find((option) => !option.disabled) ?? null;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [menuPosition, setMenuPosition] = useState<SelectMenuPosition | null>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setMenuPosition(selectMenuPosition(trigger.getBoundingClientRect(), options.length, {
      height: window.innerHeight,
      scaleInverse: pageScaleInverse(),
      width: window.innerWidth,
    }));
  }, [options.length]);

  const openMenu = useCallback((preferredIndex = selectedIndex) => {
    if (disabled || options.length === 0) return;
    const nextIndex = enabledOptionIndex(options, preferredIndex, 1);
    setActiveIndex(nextIndex);
    setOpen(true);
  }, [disabled, options, selectedIndex]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const selectOption = useCallback((option: SelectOption) => {
    if (option.disabled) return;
    if (option.value !== value) onValueChange(option.value);
    closeMenu(true);
  }, [closeMenu, onValueChange, value]);

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
    const update = () => updateMenuPosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [closeMenu, open, updateMenuPosition]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      closeMenu();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) openMenu();
      else if (activeIndex >= 0) selectOption(options[activeIndex]);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (!open) {
      openMenu(event.key === 'ArrowUp' || event.key === 'End' ? options.length - 1 : selectedIndex);
      return;
    }
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    const start = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : activeIndex + direction;
    setActiveIndex(enabledOptionIndex(options, start, direction));
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`sd-field sd-select-field ${open ? 'is-open' : ''} ${className}`}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        style={style}
        title={title}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={onKeyDown}
      >
        <span className="sd-select-field__value">{selectedOption?.label ?? ''}</span>
        <ChevronDown className="sd-select-field__chevron" size={15} aria-hidden="true" />
      </button>
      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className="sd-select-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={{
              ...style,
              left: menuPosition.left,
              maxHeight: menuPosition.maxHeight,
              top: menuPosition.top,
              width: menuPosition.width,
            }}
          >
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  key={`${option.value}:${index}`}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  className={`sd-select-menu__option ${index === activeIndex ? 'is-active' : ''}`}
                  aria-selected={selected}
                  data-option-index={index}
                  disabled={option.disabled}
                  onClick={() => selectOption(option)}
                  onPointerMove={() => !option.disabled && setActiveIndex(index)}
                >
                  <span>{option.label}</span>
                  {selected ? <Check size={15} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

export function selectMenuPosition(
  rect: Pick<DOMRect, 'bottom' | 'left' | 'top' | 'width'>,
  optionCount: number,
  viewport: SelectMenuViewport,
): SelectMenuPosition {
  const scaleInverse = viewport.scaleInverse && viewport.scaleInverse > 0 ? viewport.scaleInverse : 1;
  // getBoundingClientRect 返回视觉像素，而缩放 body 内的固定定位门户使用缩放前的 CSS 像素。
  const viewportWidth = viewport.width * scaleInverse;
  const viewportHeight = viewport.height * scaleInverse;
  const rectLeft = rect.left * scaleInverse;
  const rectTop = rect.top * scaleInverse;
  const rectBottom = rect.bottom * scaleInverse;
  const rectWidth = rect.width * scaleInverse;
  const desiredHeight = Math.min(MENU_MAX_HEIGHT, optionCount * 36 + 12);
  const spaceBelow = viewportHeight - rectBottom - VIEWPORT_GUTTER;
  const spaceAbove = rectTop - VIEWPORT_GUTTER;
  const opensAbove = spaceBelow < Math.min(desiredHeight, 160) && spaceAbove > spaceBelow;
  const availableHeight = Math.max(88, (opensAbove ? spaceAbove : spaceBelow) - MENU_GAP);
  const maxHeight = Math.min(MENU_MAX_HEIGHT, availableHeight);
  const width = Math.min(Math.max(rectWidth, 160), viewportWidth - VIEWPORT_GUTTER * 2);
  const left = Math.min(
    Math.max(VIEWPORT_GUTTER, rectLeft),
    viewportWidth - width - VIEWPORT_GUTTER,
  );
  const menuHeight = Math.min(desiredHeight, maxHeight);

  return {
    left,
    maxHeight,
    top: opensAbove ? Math.max(VIEWPORT_GUTTER, rectTop - MENU_GAP - menuHeight) : rectBottom + MENU_GAP,
    width,
  };
}

function pageScaleInverse(): number {
  const value = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--app-page-scale-inverse'));
  return Number.isFinite(value) && value > 0 ? value : 1;
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

function enabledOptionIndex(options: SelectOption[], start: number, direction: 1 | -1): number {
  if (options.length === 0) return -1;
  let index = Math.min(Math.max(start, 0), options.length - 1);
  for (let checked = 0; checked < options.length; checked += 1) {
    if (!options[index]?.disabled) return index;
    index = (index + direction + options.length) % options.length;
  }
  return -1;
}
