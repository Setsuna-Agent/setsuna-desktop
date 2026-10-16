import type { WebContents } from 'electron';
import type { BrowserPageSleepBlocker } from '../contracts/page-lifecycle.js';

export function nativePageSleepBlocker(contents: WebContents): BrowserPageSleepBlocker | null {
  if (contents.isDestroyed() || contents.isCrashed()) return 'unavailable';
  if (contents.isLoading()) return 'busy';
  if (contents.isCurrentlyAudible() || contents.isBeingCaptured()) return 'media';
  return null;
}

export async function inspectPageSleepBlocker(contents: WebContents): Promise<BrowserPageSleepBlocker | null> {
  const frames = contents.mainFrame.framesInSubtree;
  const results = await Promise.all(frames.map((frame) => frame.executeJavaScript(pageSleepGuardScript)));
  if (results.includes('media')) return 'media';
  if (results.includes('unsaved')) return 'unsaved';
  return results.every((result) => result === null) ? null : 'unavailable';
}

// Read only on a manual sleep request, including cross-origin frames. Conservatively
// protect populated editors: framework-controlled inputs need not retain defaultValue.
export const pageSleepGuardScript = `(() => {
  const inspect = (root) => {
    for (const media of root.querySelectorAll('audio, video')) {
      if (!media.paused && !media.ended) return 'media';
    }
    for (const field of root.querySelectorAll('input, textarea, select, [contenteditable]')) {
      if (field.disabled || field.readOnly) continue;
      if (field.isContentEditable && field.textContent.trim()) return 'unsaved';
      if (field instanceof HTMLSelectElement) {
        if ([...field.options].some(option => option.selected !== option.defaultSelected)) return 'unsaved';
      } else if (field instanceof HTMLInputElement) {
        if (['hidden', 'button', 'submit', 'reset', 'image'].includes(field.type)) continue;
        if (['checkbox', 'radio'].includes(field.type)) {
          if (field.checked !== field.defaultChecked) return 'unsaved';
        } else if (field.value) return 'unsaved';
      } else if (field instanceof HTMLTextAreaElement && field.value) return 'unsaved';
    }
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) {
        const blocker = inspect(element.shadowRoot);
        if (blocker) return blocker;
      }
    }
    return null;
  };
  return document.designMode === 'on' ? 'unsaved' : inspect(document);
})()`;
