import { CheckField, TextField as HostTextField, type TextFieldProps as HostTextFieldProps } from '@setsuna-desktop/renderer-ui';
import { forwardRef, useId, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

const classes = (...values: (string | undefined | false)[]) => values.filter(Boolean).join(' ');

export type TextFieldProps = HostTextFieldProps & { label?: ReactNode };
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, id: requestedId, className, ...props }, ref) {
    const generatedId = useId(); const id = requestedId ?? generatedId;
    const input = <HostTextField {...props} id={id} ref={ref} className={className} />;
    return label === undefined ? input : <label className="sa-field" htmlFor={id}><span className="sa-label">{label}</span>{input}</label>;
  },
);
/** Keep native form events and refs while using the host's checkbox mark and palette. */
export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: ReactNode };
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, children, className, ...props }, ref) {
    const text = label === undefined ? children : label;
    return <label className={classes('sd-checkbox', props.disabled && 'is-disabled', className)}><CheckField {...props} ref={ref} />{text === undefined ? null : <span>{text}</span>}</label>;
  },
);
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('sa-panel', className)} />;
}
export function AppLayout({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <main {...props} className={classes('sa-app', className)} />;
}
