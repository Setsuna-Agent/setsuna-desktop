import type { RuntimeInlineMessageAttachment } from '@setsuna-desktop/contracts';

export type BrowserAnnotationSendHandler = (input: string, screenshots: RuntimeInlineMessageAttachment[]) => Promise<boolean>;

export type BrowserAnnotationTarget = Readonly<{
  id: string;
  url: string;
  title: string;
  selector: string;
  tag: string;
  text: string;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  viewport: Readonly<{ width: number; height: number }>;
  styles: Readonly<Record<string, string>>;
}>;

export type BrowserAnnotation = Readonly<{
  target: BrowserAnnotationTarget;
  comment: string;
}>;

export type BrowserAnnotationAnchor = Pick<BrowserAnnotationTarget, 'bounds' | 'viewport'>;

export type BrowserAnnotationMarkers = Readonly<{
  visible: boolean;
  ids: readonly string[];
  activeId?: string | null;
}>;

export const BROWSER_ANNOTATION_LIMIT = 20;
export const BROWSER_ANNOTATION_COMMENT_LIMIT = 2_000;

export function parseAnnotationAnchor(value: unknown): BrowserAnnotationAnchor | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as BrowserAnnotationAnchor;
  if (!input.bounds || !input.viewport) return null;
  const { x, y, width, height } = input.bounds;
  if (![x, y, width, height, input.viewport.width, input.viewport.height].every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  if (width < 0 || height < 0 || input.viewport.width <= 0 || input.viewport.height <= 0) return null;
  return { bounds: { x, y, width, height }, viewport: { width: input.viewport.width, height: input.viewport.height } };
}

export function parseAnnotationTarget(value: unknown): BrowserAnnotationTarget | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as BrowserAnnotationTarget;
  const strings = { id: 36, url: 8_192, title: 300, selector: 2_000, tag: 100, text: 500 } as const;
  for (const [key, limit] of Object.entries(strings)) {
    const item = input[key as keyof typeof strings];
    if (typeof item !== 'string' || item.length > limit) return null;
  }
  const anchor = parseAnnotationAnchor(input);
  if (!input.selector || !anchor || !input.styles || typeof input.styles !== 'object') return null;
  const styles = Object.entries(input.styles);
  if (styles.length > 20 || styles.some(([key, item]) => key.length > 50 || typeof item !== 'string' || item.length > 200)) return null;
  return {
    id: input.id, url: input.url, title: input.title, selector: input.selector, tag: input.tag, text: input.text,
    ...anchor,
    styles: Object.fromEntries(styles),
  };
}
