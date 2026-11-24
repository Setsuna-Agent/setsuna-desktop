// Editors and settings can share a window. Refocusing also picks up changes made in another window.
const archiveChanged = 'setsuna:design-conversation-archive-changed';

export function notifyDesignConversationArchiveChanged() {
  window.dispatchEvent(new Event(archiveChanged));
}

export function observeDesignConversationArchives(refresh: () => void) {
  window.addEventListener(archiveChanged, refresh);
  window.addEventListener('focus', refresh);
  return () => {
    window.removeEventListener(archiveChanged, refresh);
    window.removeEventListener('focus', refresh);
  };
}
