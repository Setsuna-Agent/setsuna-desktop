import type { DesktopRuntimeClient } from '@setsuna-desktop/contracts';
import type { DesktopDiffFile, DesktopFileChangeReference } from '@setsuna-desktop/feature-review/contracts';
import { fileChangeSummaryFromRuns } from '../chat/tool-runs/runtimeFileChanges.js';
import { desktopDiffSummaryFromRuntimeFileChanges } from './runtimeReviewSummary.js';

type PreviewClient = Pick<DesktopRuntimeClient, 'getThreadFileChangePreview'>;

/** The preload transport cannot cancel an in-flight request. Keep its slot until
 * it settles, but remove cancelled queued work before it reaches the runtime. */
export function createReviewFileChangePreviewLoader(getClient: () => PreviewClient) {
  let client: PreviewClient | undefined;
  let active = 0;
  const queue = new Set<() => void>();
  const drain = () => {
    while (active < 4 && queue.size) {
      const next = queue.values().next().value!;
      queue.delete(next);
      next();
    }
  };
  const read = async (reference: DesktopFileChangeReference): Promise<DesktopDiffFile> => {
    client ??= getClient();
    const operations = await client.getThreadFileChangePreview(reference.threadId, {
      path: reference.path, toolCallIds: reference.toolCallIds,
    });
    const summary = desktopDiffSummaryFromRuntimeFileChanges(fileChangeSummaryFromRuns(operations.map(({ run }) => run)));
    const file = summary?.files.find((item) => item.path === reference.path);
    if (!file) throw new Error('The requested file preview is no longer available.');
    return file;
  };
  return (reference: DesktopFileChangeReference, signal: AbortSignal): Promise<DesktopDiffFile> => (
    new Promise((resolve, reject) => {
      const cancel = () => {
        queue.delete(start);
        signal.removeEventListener('abort', cancel);
        reject(new DOMException('File preview cancelled.', 'AbortError'));
      };
      const start = () => {
        active += 1;
        void read(reference).then(resolve, reject).finally(() => {
          signal.removeEventListener('abort', cancel);
          active -= 1;
          drain();
        });
      };
      if (signal.aborted) { cancel(); return; }
      queue.add(start);
      signal.addEventListener('abort', cancel, { once: true });
      drain();
    })
  );
}
