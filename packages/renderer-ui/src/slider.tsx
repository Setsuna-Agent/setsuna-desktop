import { forwardRef, type CSSProperties, type InputHTMLAttributes } from 'react';
import { cn } from './utils.js';

export const Slider = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue'> & { value: number | string }>(function Slider({ className, style, min = 0, max = 100, value, ...props }, ref) {
  const progress = Math.max(0, Math.min(100, (Number(value ?? min) - Number(min)) / (Number(max) - Number(min) || 1) * 100));
  return <input {...props} ref={ref} type="range" min={min} max={max} value={value}
    className={cn('sd-slider', className)} style={{ ...style, '--sd-slider-progress': `${progress}%` } as CSSProperties} />;
});
