// Adapted from beUI Switch and Checkbox (MIT), retaining native form semantics.
import { motion, useReducedMotion } from 'motion/react';
import { forwardRef, useCallback, useId, type CSSProperties, type InputHTMLAttributes, type MouseEventHandler, type ReactNode } from 'react';
import { Button } from './button.js';
import { SPRING_PRESS } from './motion.js';
import { cn } from './utils.js';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'onClick' | 'children' | 'checked'> & {
  checked: boolean;
  indeterminate?: boolean;
  children?: ReactNode;
  onChange(checked: boolean): void;
  onClick?: MouseEventHandler<HTMLLabelElement>;
};

/** Native-event variant for ordinary forms; shares the checkbox mark and palette. */
export const CheckField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function CheckField({ className, ...props }, ref) {
  return <span className="sd-checkbox__box">
    <input {...props} type="checkbox" className={cn('sd-checkbox__control', className)} ref={ref} />
    <svg aria-hidden="true" viewBox="0 0 24 24" className="sd-checkbox__native-mark"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </span>;
});
export function Checkbox({ checked, indeterminate, children, className, onChange, onClick, ...props }: CheckboxProps) {
  const reduce = useReducedMotion();
  const attach = useCallback((node: HTMLInputElement | null) => { if (node) node.indeterminate = Boolean(indeterminate); }, [indeterminate]);
  return <label className={cn('sd-checkbox', props.disabled && 'is-disabled', className)} onClick={onClick}>
    <span className="sd-checkbox__box">
      <input {...props} ref={attach} type="checkbox" className="sd-checkbox__control" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <motion.svg aria-hidden="true" viewBox="0 0 24 24" initial={false} animate={{ opacity: checked || indeterminate ? 1 : 0, scale: checked || indeterminate ? 1 : 0.5 }} transition={reduce ? { duration: 0 } : SPRING_PRESS}>
        <path d={indeterminate ? 'M6 12h12' : 'M5 13l4 4L19 7'} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </motion.svg>
    </span>
    {children}
  </label>;
}

export function Switch({ id: suppliedId, checked, onCheckedChange, disabled, label, className }: {
  id?: string; checked: boolean; onCheckedChange(checked: boolean): void; disabled?: boolean; label?: string; className?: string;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const reduce = useReducedMotion();
  return <button id={id} type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled}
    className={cn('sd-switch', className)} data-state={checked ? 'checked' : 'unchecked'} onClick={() => onCheckedChange(!checked)}>
    <motion.span className="sd-switch__thumb" initial={false} animate={{ x: checked ? 14 : 0 }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 800, damping: 80, mass: 4 }} />
  </button>;
}

export function SegmentedControl<T extends string>({ label, value, options, iconOnly, disabled, className, onChange }: Readonly<{
  label: string;
  value: T;
  options: readonly Readonly<{ value: T; label: string; icon?: ReactNode }>[];
  iconOnly?: boolean;
  disabled?: boolean;
  className?: string;
  onChange(value: T): void;
}>) {
  const index = options.findIndex((option) => option.value === value);
  return <div className={cn('sd-segmented-control', className)} role="group" aria-label={label}
    data-selected={index >= 0 || undefined} data-icon-only={iconOnly || undefined}
    style={{ '--sd-segment-count': options.length, '--sd-segment-index': index } as CSSProperties}>
    {options.map((option) => <Button key={option.value} variant="ghost" icon={option.icon} aria-pressed={option.value === value}
      aria-label={iconOnly ? option.label : undefined} title={iconOnly ? option.label : undefined}
      disabled={disabled} onClick={() => onChange(option.value)}>{iconOnly ? null : option.label}</Button>)}
  </div>;
}
