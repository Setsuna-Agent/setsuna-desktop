import {
  getSingularPatch,
  setLanguageOverride,
  type FileDiff as PierreFileDiff,
  type PostRenderPhase,
} from '@pierre/diffs';
import {
  CodeView,
  File,
  FileDiff,
  Virtualizer,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
  type FileContents,
  type DiffLineAnnotation,
  type FileOptions,
  type FileDiffProps,
} from '@pierre/diffs/react';
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { useCodeAppearance } from './CodeAppearanceProvider.js';
import { inferPatchLanguageOverride } from './patchLanguage.js';

type CodeFileViewProps = {
  cacheKey?: string;
  className?: string;
  codeViewLayout?: CodeViewReactOptions<undefined>['layout'];
  containerRef?: Ref<HTMLDivElement>;
  contents: string;
  disableBackground?: boolean;
  language?: string;
  lineFocusRequest?: { line: number; version: number };
  name: string;
  showHeader?: boolean;
  showLineNumbers?: boolean;
  style?: CSSProperties;
  unsafeCSS?: string;
  virtualized?: boolean;
  wrap?: boolean;
};

type CodePatchViewProps = {
  children?: ReactNode;
  className?: string;
  layout?: 'split' | 'unified';
  lineAnnotations?: DiffLineAnnotation<ReactNode>[];
  onPostRender?: (
    node: HTMLElement,
    instance: PierreFileDiff<ReactNode>,
    phase: PostRenderPhase,
  ) => unknown;
  patch: string;
  showHeader?: boolean;
  virtualized?: boolean;
  wrap?: boolean;
};

export const pierreSurfaceStyle = {
  '--diffs-font-family': 'var(--app-code-font-family)',
  '--diffs-header-font-family': 'var(--app-font-family)',
  '--diffs-font-size': '12px',
  '--diffs-line-height': '20px',
} as CSSProperties;

export function CodeFileView({
  cacheKey,
  className,
  codeViewLayout,
  containerRef,
  contents,
  disableBackground = false,
  language,
  lineFocusRequest,
  name,
  showHeader = false,
  showLineNumbers = true,
  style,
  unsafeCSS,
  virtualized = false,
  wrap = false,
}: CodeFileViewProps) {
  const codeViewRef = useRef<CodeViewHandle<undefined>>(null);
  const options = usePierreFileOptions({
    disableBackground,
    layout: codeViewLayout,
    showHeader,
    showLineNumbers,
    unsafeCSS,
    wrap,
  });
  const file = useMemo<FileContents>(() => ({
    cacheKey,
    contents,
    ...(language ? { lang: language } : {}),
    name,
  }), [cacheKey, contents, language, name]);
  const codeViewVersion = useMemo(
    () => cacheKey ? undefined : codeContentsVersion(contents),
    [cacheKey, contents],
  );
  const itemId = cacheKey ?? name;
  const codeViewItems = useMemo<readonly CodeViewItem<undefined>[]>(() => [{
    id: itemId,
    type: 'file',
    file,
    version: codeViewVersion,
  }], [codeViewVersion, file, itemId]);
  useCodeViewLineFocus(codeViewRef, itemId, lineFocusRequest, virtualized);
  const surface = (
    <File
      className={['setsuna-pierre-surface', className].filter(Boolean).join(' ')}
      disableWorkerPool
      file={file}
      options={options}
      style={style ? { ...pierreSurfaceStyle, ...style } : pierreSurfaceStyle}
    />
  );

  if (typeof window === 'undefined') {
    return <pre className={className}><code>{contents}</code></pre>;
  }
  return virtualized ? (
    <CodeView
      className={['setsuna-pierre-surface', className].filter(Boolean).join(' ')}
      containerRef={containerRef}
      disableWorkerPool
      items={codeViewItems}
      options={options}
      ref={codeViewRef}
      style={style ? { ...pierreSurfaceStyle, ...style } : pierreSurfaceStyle}
    />
  ) : surface;
}

export function useCodeViewLineFocus(
  codeViewRef: RefObject<CodeViewHandle<undefined> | null>,
  itemId: string,
  request: { line: number; version: number } | undefined,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || !request) return;
    codeViewRef.current?.scrollTo({
      type: 'line',
      id: itemId,
      lineNumber: request.line,
      align: 'center',
      behavior: 'instant',
    });
  }, [codeViewRef, enabled, itemId, request?.line, request?.version]);
}

export function CodePatchView({
  children,
  className,
  layout = 'unified',
  lineAnnotations,
  onPostRender,
  patch,
  showHeader = false,
  virtualized = false,
  wrap = false,
}: CodePatchViewProps) {
  const options = usePierreDiffOptions<ReactNode>({
    layout,
    onPostRender,
    showHeader,
    wrap,
  });
  const fileDiff = useMemo(() => {
    const parsed = getSingularPatch(patch);
    const language = inferPatchLanguageOverride(parsed.name, patch);
    return language ? setLanguageOverride(parsed, language) : parsed;
  }, [patch]);
  const surface = (
    <FileDiff
      className={['setsuna-pierre-surface', className].filter(Boolean).join(' ')}
      disableWorkerPool
      fileDiff={fileDiff}
      lineAnnotations={lineAnnotations}
      options={options}
      renderAnnotation={(annotation) => annotation.metadata}
      style={pierreSurfaceStyle}
    />
  );

  if (typeof window === 'undefined') {
    return (
      <>
        <pre className={className}><code>{patch}</code></pre>
        {children}
      </>
    );
  }
  return (
    <>
      {virtualized ? <Virtualizer className="setsuna-pierre-virtualizer">{surface}</Virtualizer> : surface}
      {children}
    </>
  );
}

export function usePierreFileOptions({
  disableBackground = false,
  layout,
  showHeader = false,
  showLineNumbers = true,
  unsafeCSS,
  wrap = false,
}: {
  disableBackground?: boolean;
  layout?: CodeViewReactOptions<undefined>['layout'];
  showHeader?: boolean;
  showLineNumbers?: boolean;
  unsafeCSS?: string;
  wrap?: boolean;
} = {}): FileOptions<undefined> & CodeViewReactOptions<undefined> {
  const appearance = useCodeAppearance();
  return useMemo<FileOptions<undefined> & CodeViewReactOptions<undefined>>(() => ({
    disableBackground,
    disableFileHeader: !showHeader,
    disableLineNumbers: !showLineNumbers,
    lineHoverHighlight: 'both',
    ...(layout ? { layout } : {}),
    overflow: wrap ? 'wrap' : 'scroll',
    theme: appearance.themes,
    themeType: appearance.resolvedTheme,
    ...(unsafeCSS ? { unsafeCSS } : {}),
  }), [appearance.resolvedTheme, appearance.themes, disableBackground, layout, showHeader, showLineNumbers, unsafeCSS, wrap]);
}

export function usePierreDiffOptions<LAnnotation = undefined>({
  layout = 'unified',
  onPostRender,
  showHeader = false,
  wrap = false,
}: {
  layout?: 'split' | 'unified';
  onPostRender?: (
    node: HTMLElement,
    instance: PierreFileDiff<LAnnotation>,
    phase: PostRenderPhase,
  ) => unknown;
  showHeader?: boolean;
  wrap?: boolean;
} = {}): NonNullable<FileDiffProps<LAnnotation>['options']> {
  const appearance = useCodeAppearance();
  return useMemo(() => ({
    diffIndicators: 'bars' as const,
    diffStyle: layout,
    disableFileHeader: !showHeader,
    hunkSeparators: 'line-info' as const,
    lineDiffType: 'none' as const,
    lineHoverHighlight: 'both' as const,
    onPostRender,
    overflow: wrap ? 'wrap' as const : 'scroll' as const,
    theme: appearance.themes,
    themeType: appearance.resolvedTheme,
  }), [appearance.resolvedTheme, appearance.themes, layout, onPostRender, showHeader, wrap]);
}

function codeContentsVersion(contents: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < contents.length; index += 1) {
    hash = Math.imul(hash ^ contents.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
}
