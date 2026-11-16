import { useEffect, useState } from 'react';

/** One clock for the visible directory, with slower updates once all tasks finish. */
export function useCollaborationTaskClock(active: boolean, hasActiveTasks: boolean): number {
  const [nowMs, setNowMs] = useState(Date.now);
  const intervalMs = hasActiveTasks ? 1_000 : 60_000;
  useEffect(() => {
    if (!active) return;
    const update = () => {
      if (!document.hidden) setNowMs(Date.now());
    };
    update();
    const timer = window.setInterval(update, intervalMs);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [active, intervalMs]);
  return nowMs;
}
