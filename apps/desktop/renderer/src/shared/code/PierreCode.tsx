import { getSingularPatch, setLanguageOverride } from '@pierre/diffs';
import {
  CodeView,
  File,
  FileDiff,
  Virtualizer,
  type CodeViewItem,
  type CodeViewReactOptions,
  type FileContents,
  type FileOptions,
  type FileDiffProps,
} from '@pierre/diffs/react';
import { useMemo, type CSSProperties, type ReactNode, type Ref } from 'react';
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
  name,
  showHeader = false,
  showLineNumbers = true,
  style,
  unsafeCSS,
  virtualized = false,
  wrap = false,
}: CodeFileViewProps) {
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
  const codeViewItems = useMemo<readonly CodeViewItem<undefined>[]>(() => [{
    id: cacheKey ?? name,
    type: 'file',
    file,
    version: codeViewVersion,
  }], [cacheKey, codeViewVersion, file, name]);
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
      style={style ? { ...pierreSurfaceStyle, ...style } : pierreSurfaceStyle}
    />
  ) : surface;
}

export function CodePatchView({
  children,
  className,
  layout = 'unified',
  patch,
  showHeader = false,
  virtualized = false,
  wrap = false,
}: CodePatchViewProps) {
  const options = usePierreDiffOptions({ layout, showHeader, wrap });
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
      options={options}
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

export function usePierreDiffOptions({
  layout = 'unified',
  showHeader = false,
  wrap = false,
}: {
  layout?: 'split' | 'unified';
  showHeader?: boolean;
  wrap?: boolean;
} = {}): NonNullable<FileDiffProps<undefined>['options']> {
  const appearance = useCodeAppearance();
  return useMemo(() => ({
    diffIndicators: 'bars' as const,
    diffStyle: layout,
    disableFileHeader: !showHeader,
    hunkSeparators: 'line-info' as const,
    lineDiffType: 'none' as const,
    lineHoverHighlight: 'both' as const,
    overflow: wrap ? 'wrap' as const : 'scroll' as const,
    theme: appearance.themes,
    themeType: appearance.resolvedTheme,
  }), [appearance.resolvedTheme, appearance.themes, layout, showHeader, wrap]);
}

function codeContentsVersion(contents: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < contents.length; index += 1) {
    hash = Math.imul(hash ^ contents.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
}
