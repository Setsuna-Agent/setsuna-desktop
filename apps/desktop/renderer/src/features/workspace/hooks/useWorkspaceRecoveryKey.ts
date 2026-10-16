import { useEffect, useState } from 'react';

/** Let the shell paint before recovered tabs can create webviews, file reads or shells. */
export function useWorkspaceRecoveryKey(windowKey: string | null): string | null {
  const [recoveredKey, setRecoveredKey] = useState<string | null>(null);
  useEffect(() => {
    if (!windowKey || recoveredKey === windowKey) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        timer = setTimeout(() => setRecoveredKey(windowKey), 0);
      });
    });
    return () => { window.cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [recoveredKey, windowKey]);
  return recoveredKey;
}
