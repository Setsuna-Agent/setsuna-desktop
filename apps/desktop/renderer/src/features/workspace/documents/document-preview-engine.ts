import type { DocumentPreviewFormat } from '@setsuna-desktop/contracts';

export type DocumentPreviewViewer = {
  load(data: ArrayBuffer): Promise<void>;
  destroy(): void;
};
export type DocumentPreviewFactory = (container: HTMLElement, onError: (error: Error) => void) => DocumentPreviewViewer;

const commonOptions = {
  mode: 'worker' as const,
  useGoogleFonts: false,
  enableHyperlinks: false,
  comments: false,
  workerTimeoutMs: 30_000,
};

export async function loadDocumentPreviewFactory(format: DocumentPreviewFormat): Promise<DocumentPreviewFactory> {
  if (format === 'pdf') {
    const { createPdfPreview } = await import('./pdf-preview.js');
    return createPdfPreview;
  }
  if (format === 'docx') {
    const { DocxScrollViewer } = await import('@silurus/ooxml/docx');
    return (container, onError) => new DocxScrollViewer(container, {
      ...commonOptions, onError, progressiveLayout: true, enableTextSelection: true, refitOnResize: true,
    });
  }
  if (format === 'pptx') {
    const { PptxScrollViewer } = await import('@silurus/ooxml/pptx');
    return (container, onError) => new PptxScrollViewer(container, {
      ...commonOptions, onError, enableTextSelection: true, enableMediaPlayback: false, refitOnResize: true,
    });
  }
  const { XlsxViewer, XlsxSheetViewer } = await import('@silurus/ooxml/xlsx');
  if (format === 'xlsx') {
    return (container, onError) => new XlsxViewer(container, { ...commonOptions, onError, showZoomSlider: false });
  }
  return (container, onError) => {
    const canvas = document.createElement('canvas');
    // The sheet viewer copies inline dimensions to its wrapper when it mounts.
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.append(canvas);
    const viewer = new XlsxSheetViewer(canvas, { ...commonOptions, onError });
    return {
      // Preserve CSV fields as text, including leading zeros and formula-looking values.
      load: (data) => viewer.load(data, { format: 'csv' }),
      destroy: () => { viewer.destroy(); canvas.remove(); },
    };
  };
}
