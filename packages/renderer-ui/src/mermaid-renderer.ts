import { createMermaidTheme, type MermaidTheme } from './mermaid-theme.js';

const maxDiagramCharacters = 50_000;
let nextDiagramId = 0;
let renderQueue: Promise<void> = Promise.resolve();

/** Mermaid keeps global configuration and diagram state, so initialize and render together. */
export function renderMermaidDiagram(code: string, theme: MermaidTheme, signal: AbortSignal): Promise<string | null> {
  if (!code.trim() || code.length > maxDiagramCharacters) return Promise.resolve(null);

  const result = renderQueue.then(async () => {
    if (signal.aborted) return null;
    // Diagram code and layouts stay out of the initial renderer bundle.
    const { default: mermaid } = await import('mermaid');
    if (signal.aborted) return null;

    const appearance = createMermaidTheme(theme);
    mermaid.initialize({
      ...appearance,
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: maxDiagramCharacters,
      maxEdges: 500,
      htmlLabels: false,
      layout: 'dagre',
      // Document directives must not relax sanitization or inject global CSS while measuring.
      secure: [
        'secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges',
        'suppressErrorRendering', 'dompurifyConfig', 'themeCSS', 'htmlLabels',
        'fontFamily', 'themeVariables',
      ],
    });

    const container = document.createElement('div');
    container.className = 'sd-mermaid-measure';
    container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);
    try {
      const { svg } = await mermaid.render(`setsuna-mermaid-${++nextDiagramId}`, code, container);
      if (signal.aborted) return null;
      return diagramImageSource(svg, appearance.themeVariables.background);
    } finally {
      container.remove();
    }
  });
  // A malformed diagram must not prevent later blocks from rendering.
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}

function diagramImageSource(svg: string, background: string): string {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || document.querySelector('parsererror')) {
    throw new Error('Invalid Mermaid SVG');
  }
  const [, , width, height] = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)) {
    // Keep full resolution for the image viewer; the inline thumbnail fits the available width.
    root.setAttribute('width', String(width));
    root.setAttribute('height', String(height));
  }
  // Keep labels and edges readable against the image viewer's dark backdrop.
  root.style.backgroundColor = background;
  // SVG images cannot execute diagram links/scripts or apply styles to the surrounding app.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
}
