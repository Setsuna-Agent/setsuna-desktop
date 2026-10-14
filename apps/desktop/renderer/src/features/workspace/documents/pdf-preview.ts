/** Electron's built-in PDF reader provides paging, zoom and search without a second parser bundle. */
export function createPdfPreview(container: HTMLElement) {
  const frame = document.createElement('iframe');
  frame.className = 'desktop-document-preview__pdf';
  frame.title = 'PDF';
  let url: string | undefined;
  let finishPendingLoad: (() => void) | undefined;
  return {
    load: (data: ArrayBuffer): Promise<void> => new Promise((resolve, reject) => {
      finishPendingLoad = resolve;
      frame.onload = () => { finishPendingLoad = undefined; resolve(); };
      frame.onerror = () => { finishPendingLoad = undefined; reject(new Error('Failed to load PDF preview.')); };
      url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      frame.src = url;
      container.append(frame);
    }),
    destroy: () => {
      frame.onload = null;
      frame.onerror = null;
      frame.remove();
      if (url) URL.revokeObjectURL(url);
      url = undefined;
      // Unmounting a frame can suppress its load event; release that pending promise too.
      finishPendingLoad?.();
      finishPendingLoad = undefined;
    },
  };
}
