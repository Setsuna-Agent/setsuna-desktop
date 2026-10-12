import type { ReactNode } from 'react';
import { ImagePreview } from './image-preview.js';
import { useMermaidDiagram } from './use-mermaid-diagram.js';

export function MermaidDiagram({ code, fallback }: { code: string; fallback: ReactNode }) {
  const src = useMermaidDiagram(code);
  if (!src) return <>{fallback}</>;

  return <div className="sd-mermaid-diagram">
    <ImagePreview src={src} alt="Mermaid" />
  </div>;
}
