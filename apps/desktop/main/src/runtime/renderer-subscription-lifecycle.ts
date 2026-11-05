import type { WebContents } from 'electron';

/** A surviving WebContents does not imply that the document owning an SSE subscription survived. */
export function trackRendererSubscription(contents: WebContents, unsubscribe: () => void): () => void {
  contents.once('destroyed', unsubscribe);
  contents.once('render-process-gone', unsubscribe);
  // Navigation guards can cancel did-start-navigation; only a committed main-frame
  // navigation replaces this document. did-navigate excludes subframes and in-page history.
  contents.once('did-navigate', unsubscribe);
  return () => {
    contents.removeListener('destroyed', unsubscribe);
    contents.removeListener('render-process-gone', unsubscribe);
    contents.removeListener('did-navigate', unsubscribe);
  };
}
