import { useEffect } from 'react';

export function useNotificationNavigation(openThread: (threadId: string) => Promise<void>, onError: (message: string) => void) {
  useEffect(() => window.setsunaDesktop?.notifications?.onOpenThread((threadId) => {
    void openThread(threadId).catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  }), [onError, openThread]);
}
