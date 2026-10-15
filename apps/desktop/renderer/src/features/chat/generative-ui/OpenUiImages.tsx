import type { ComponentRenderProps, ComponentRenderer } from '@openuidev/react-lang';
import { useWorkspaceImageSources } from '../markdown/useWorkspaceImageSources.js';

const imageComponents = new Set([
  'Image', 'ImageBlock', 'ImageGallery', 'ImageText', 'ImageTextLarge',
  'ListBlock', 'ContextCardBlock', 'VisualCardBlock',
]);

export function withWorkspaceImages(name: string, Render: ComponentRenderer): ComponentRenderer {
  if (!imageComponents.has(name)) return Render;
  return function WorkspaceImages({ props, ...rest }: ComponentRenderProps) {
    const inputs: string[] = [];
    mapImageProps(props, (source) => { inputs.push(source); return source; });
    const sources = useWorkspaceImageSources(inputs);
    const safeProps = mapImageProps(props, (source) => sources.get(source)?.source) as typeof props;
    return <Render {...rest} props={safeProps} />;
  };
}

// Some parents consume data subcomponents directly rather than renderNode, so
// sanitize their nested image fields too, before any upstream element is created.
function mapImageProps(value: unknown, resolve: (source: string) => string | undefined): unknown {
  if (Array.isArray(value)) return value.map((entry) => mapImageProps(entry, resolve));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    (key === 'src' || key === 'bgImageSrc')
      ? typeof entry === 'string' ? resolve(entry) : undefined
      : mapImageProps(entry, resolve),
  ]));
}
