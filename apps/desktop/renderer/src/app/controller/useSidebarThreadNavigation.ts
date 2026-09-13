import { useCallback, useRef } from 'react';

export function useSidebarThreadNavigation({
  currentThreadId,
  onOpenThread,
  onError,
}: {
  currentThreadId: string | null;
  onOpenThread: (threadId: string) => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const navigatingRef = useRef(false);
  const navigate = useCallback(async (direction: -1 | 1) => {
    if (navigatingRef.current) return;
    // Only mounted sidebar rows participate: collapsed groups and “show more” rows
    // stay out of navigation. Read on each key press so expansion never needs a second state model.
    const threadIds = [...document.querySelectorAll<HTMLElement>(
      '.desktop-agent-sidebar:not([aria-hidden="true"]) [data-sidebar-thread-id]',
    )].map((row) => row.dataset.sidebarThreadId!);
    const index = currentThreadId ? threadIds.indexOf(currentThreadId) : -1;
    const threadId = threadIds[index + direction];
    if (!threadId) return;

    // Reuse normal selection and serialize it so repeated keys cannot stack discard dialogs.
    navigatingRef.current = true;
    try {
      await onOpenThread(threadId);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      navigatingRef.current = false;
    }
  }, [currentThreadId, onError, onOpenThread]);

  const goPrevious = useCallback(() => { void navigate(-1); }, [navigate]);
  const goNext = useCallback(() => { void navigate(1); }, [navigate]);
  return { goPrevious, goNext };
}
