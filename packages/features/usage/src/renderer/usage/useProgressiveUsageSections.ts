import { useEffect, useState } from 'react';

/** Yield a paint between sections so the calendar and table do not block the overview. */
export function useProgressiveUsageSections(ready: boolean) {
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    if (!ready || visible >= 3) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setVisible((current) => current + 1));
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, visible]);

  // Already mounted sections stay mounted during filtering and invalidation refreshes.
  return { breakdowns: visible >= 1, calendar: visible >= 2, records: visible >= 3 };
}
