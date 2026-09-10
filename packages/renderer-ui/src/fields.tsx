// beUI input geometry, with native form events and refs for the desktop host.
import { forwardRef, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from './utils.js';

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { leadingIcon?: ReactNode };
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ className, leadingIcon, ...props }, ref) {
  const input = <input {...props} ref={ref} className={cn('sd-field', className)} />;
  return leadingIcon ? <span className="sd-field-shell"><span className="sd-field-shell__icon" aria-hidden="true">{leadingIcon}</span>{input}</span> : input;
});

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  autoSize?: boolean | { minRows?: number; maxRows?: number };
};
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ autoSize, className, ...props }, ref) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const input = localRef.current;
    if (!input || !autoSize) return;
    const resize = () => {
      const computed = getComputedStyle(input);
      const line = parseFloat(computed.lineHeight) || 20;
      const inset = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom) + 2;
      const options = typeof autoSize === 'object' ? autoSize : {};
      input.style.height = '0px';
      input.style.height = `${Math.min(Math.max(input.scrollHeight, (options.minRows ?? 1) * line + inset), (options.maxRows ?? 12) * line + inset)}px`;
    };
    resize();
    input.addEventListener('input', resize);
    return () => input.removeEventListener('input', resize);
  }, [autoSize, props.value]);
  return <textarea {...props} className={cn('sd-textarea', className)} ref={(node) => {
    localRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }} />;
});
