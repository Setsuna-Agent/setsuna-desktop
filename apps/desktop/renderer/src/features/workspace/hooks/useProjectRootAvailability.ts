import type { DesktopRuntimeClient } from '@setsuna-desktop/contracts';
import { useEffect, useState } from 'react';
import { useLatestRequestGuard } from '../../../shared/hooks/useLatestRequestGuard.js';

export function useProjectRootAvailability(projectId: string | undefined,
  listUnavailableRootIds: DesktopRuntimeClient['listUnavailableProjectRootIds']) {
  const [status, setStatus] = useState(() => ({ unavailableRootIds: new Set<string>(), failed: false }));
  const requests = useLatestRequestGuard();

  useEffect(() => {
    if (!projectId) return;
    const refresh = () => {
      const isCurrent = requests.begin();
      void listUnavailableRootIds(projectId).then((ids) => {
        if (isCurrent()) setStatus({ unavailableRootIds: new Set(ids), failed: false });
      }, () => {
        if (isCurrent()) setStatus((previous) => ({ ...previous, failed: true }));
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      requests.invalidate();
      window.removeEventListener('focus', refresh);
    };
  }, [listUnavailableRootIds, projectId, requests]);

  return status;
}
