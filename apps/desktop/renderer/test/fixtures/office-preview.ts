import { loadDocumentPreviewFactory } from '../../src/features/workspace/documents/document-preview-engine.js';
import { checkVideoPreview } from './video-preview.js';
import '../../src/shared/styles/tokens.css';
import '../../src/shared/styles/base.css';
import '../../src/features/workspace/documents/document-preview.css';

const activeWorkers = new Set<Worker>();
const NativeWorker = window.Worker;
let createdWorkers = 0;
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    activeWorkers.add(this);
    createdWorkers += 1;
  }
  override terminate() {
    activeWorkers.delete(this);
    super.terminate();
  }
};

async function checkOfficePreviews() {
  if (createdWorkers) throw new Error('Office workers were started before opening a document.');
  const parsed: string[] = [];
  const errors: string[] = [];
  const container = document.getElementById('document')!;
  for (const format of ['docx', 'pptx', 'xlsx', 'csv'] as const) {
    document.documentElement.dataset.fontSize = '85';
    const surface = document.createElement('div');
    surface.className = 'desktop-document-preview__surface desktop-document-preview__surface--office';
    container.replaceChildren(surface);
    const factory = await loadDocumentPreviewFactory(format);
    const viewer = factory(surface, (error) => errors.push(error.message));
    try {
      const data = await (await fetch(`./office/sample.${format}`)).arrayBuffer();
      await viewer.load(data);
      if ('waitUntilLayoutComplete' in viewer && typeof viewer.waitUntilLayoutComplete === 'function') {
        await viewer.waitUntilLayoutComplete();
      }
      if (format === 'xlsx' || format === 'csv') await checkSheetSelectionAcrossScales(surface, format);
      parsed.push(format);
    } finally {
      viewer.destroy();
      container.replaceChildren();
      document.documentElement.dataset.fontSize = '100';
    }
    if (activeWorkers.size) throw new Error(`${format} left a worker alive after closing.`);
  }
  const createViewer = await loadDocumentPreviewFactory('docx');
  const invalid = createViewer(container, () => undefined);
  let rejectedInvalid = false;
  try { await invalid.load(new TextEncoder().encode('invalid document').buffer); }
  catch { rejectedInvalid = true; }
  finally { invalid.destroy(); }
  const continuousSections = await checkContinuousDocxSections();
  return { parsed, errors, createdWorkers, activeWorkers: activeWorkers.size, rejectedInvalid, continuousSections };
}

async function checkSheetSelectionAcrossScales(surface: HTMLElement, format: 'xlsx' | 'csv') {
  const input = surface.querySelector<HTMLElement>('[data-xlsx-viewport-input]')!;
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let copied: string | undefined;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => { copied = text; } },
  });
  const copySelection = async (): Promise<string | undefined> => {
    copied = undefined;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
    await Promise.resolve();
    return copied;
  };
  try {
    input.focus();
    // The hidden fixture window may not deliver focus; an arrow key also initializes A1.
    const keys = format === 'csv' ? ['ArrowLeft', 'ArrowDown', 'ArrowRight'] : ['ArrowLeft', 'ArrowRight'];
    for (const key of keys) input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const expected = format === 'csv' ? '00123' : '42';
    const initial = await copySelection();
    if (initial !== expected) throw new Error(`${format}: keyboard selection copied ${JSON.stringify(initial)}, expected ${expected}.`);
    const workersBefore = createdWorkers;
    for (const scale of ['80', '105', '120', '100']) {
      document.documentElement.dataset.fontSize = scale;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (await copySelection() !== expected) throw new Error(`${format}: changing interface scale lost the selected cell.`);
      if (createdWorkers !== workersBefore) throw new Error(`${format}: changing interface scale restarted the parser.`);
    }
  } finally {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
}

async function checkContinuousDocxSections() {
  const { DocxDocument } = await import('@silurus/ooxml/docx');
  const data = await (await fetch('./office/continuous-sections.docx')).arrayBuffer();
  const modes: string[] = [];
  for (const mode of ['main', 'worker'] as const) {
    const doc = await DocxDocument.load(data.slice(0), { mode, useGoogleFonts: false, progressiveLayout: true });
    try {
      await doc.waitUntilLayoutComplete();
      const text: string[] = [];
      for (let page = 0; page < doc.pageCount; page += 1) {
        const bitmap = await doc.renderPageToBitmap(page, { width: 400, dpr: 1 });
        bitmap.close();
        text.push(...(await doc.collectPageRuns(page)).map((run) => run.text));
      }
      const content = text.join('');
      if (!content.includes('Section A paragraph 12.') || !content.includes('Section B follows the continuous section break.')) {
        throw new Error(`${mode}: continuous section content was lost.`);
      }
      modes.push(mode);
    } finally { doc.destroy(); }
  }
  return modes;
}

async function openPdfPreview() {
  const factory = await loadDocumentPreviewFactory('pdf');
  const viewer = factory(document.getElementById('document')!, () => undefined);
  const data = await (await fetch('./office/sample.pdf')).arrayBuffer();
  await viewer.load(data);
  const pdfUrl = document.querySelector<HTMLIFrameElement>('#document iframe')!.src;
  Object.assign(window, { closePdfPreview: async () => {
    viewer.destroy();
    try { await fetch(pdfUrl); return false; } catch { return true; }
  } });
}

Object.assign(window, { checkOfficePreviews, openPdfPreview, checkVideoPreview });
