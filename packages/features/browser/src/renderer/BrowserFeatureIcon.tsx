import { Globe } from 'lucide-react';

/** Keeps the Browser Feature identity consistent across host launchers and browser-owned views. */
export function BrowserFeatureIcon({
  className,
  size = 14,
}: Readonly<{
  className?: string;
  size?: number;
}>) {
  return (
    <Globe
      aria-hidden="true"
      className={className}
      data-browser-feature-icon="globe"
      size={size}
      strokeWidth={2}
    />
  );
}
