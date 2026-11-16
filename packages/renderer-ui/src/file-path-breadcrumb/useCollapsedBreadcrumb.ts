import { useLayoutEffect, useRef, useState } from 'react';

/** Measure whole path segments so the leading directory is never partially clipped. */
export function useCollapsedBreadcrumb(identity: string, parentCount: number) {
  const rootRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [hiddenCount, setHiddenCount] = useState(0);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const measure = measureRef.current;
    if (!root || !measure) return;
    const update = () => {
      const available = root.getBoundingClientRect().width;
      if (!available) return;
      // The first item measures the ellipsis; the remaining items mirror the full path.
      // Rects keep all comparisons in the same coordinates, including application zoom.
      const [ellipsis, ...widths] = Array.from(measure.children, (item) => item.getBoundingClientRect().width);
      let required = widths.reduce((sum, width) => sum + width, 0);
      let hidden = 0;
      if (required > available) {
        required += ellipsis;
        while (hidden < parentCount && required > available) required -= widths[hidden++];
      }
      setHiddenCount((current) => current === hidden ? current : hidden);
    };
    const observer = new ResizeObserver(update);
    observer.observe(root);
    observer.observe(measure);
    update();
    return () => observer.disconnect();
  }, [identity, parentCount]);

  return { rootRef, measureRef, hiddenCount };
}
