import type { WebContents } from 'electron';

type Observer = { changed?(): void; destroyed(): void };
type Watch = { observers: Set<Observer>; stop(): void };
const watches = new WeakMap<WebContents, Watch>();

/** API channels and extension frames share one native lifecycle subscription per WebContents. */
export function observeExtensionContents(contents: WebContents, observer: Observer): () => void {
  if (contents.isDestroyed()) { observer.destroyed(); return () => undefined; }
  let watch = watches.get(contents);
  if (!watch) {
    const observers = new Set<Observer>();
    const changed = () => { for (const current of [...observers]) current.changed?.(); };
    const destroyed = () => {
      const pending = [...observers];
      stop(); observers.clear();
      for (const current of pending) current.destroyed();
    };
    const stop = () => {
      contents.off('did-frame-navigate', changed).off('destroyed', destroyed);
      watches.delete(contents);
    };
    watch = { observers, stop }; watches.set(contents, watch);
    contents.on('did-frame-navigate', changed).once('destroyed', destroyed);
  }
  const current = watch;
  current.observers.add(observer);
  return () => {
    if (current.observers.delete(observer) && !current.observers.size) current.stop();
  };
}
