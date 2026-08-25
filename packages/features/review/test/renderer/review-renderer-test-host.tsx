import { getSingularPatch } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import type { DesktopDiffFile, DesktopReviewBridge } from '../../src/contracts/index.js';
import {
  ReviewRendererHostProvider,
  type ReviewCodePatchViewProps,
  type ReviewFindingMarkdownProps,
  type ReviewRendererHost,
} from '../../src/renderer/host.js';
import { translateReviewMessage } from '../../src/renderer/messages.js';
import { createElement, useMemo, type PropsWithChildren, type ReactNode } from 'react';

export function ReviewRendererTestHost({
  bridge = null,
  children,
  locale = 'zh-CN',
}: PropsWithChildren<{
  bridge?: DesktopReviewBridge | null;
  locale?: 'en-US' | 'zh-CN';
}>) {
  const host = useMemo<ReviewRendererHost>(() => ({
    bridge,
    buildPatch: testDiffPatch,
    notifySuccess: () => undefined,
    translate: (key, params) => key === 'common.cancel'
      ? locale === 'en-US' ? 'Cancel' : '取消'
      : translateReviewMessage(locale, key, params),
    ui: {
      Checkbox: ({
        checked,
        children: label,
        className,
        indeterminate,
        onChange,
        onClick,
        ...props
      }) => (
        <label className={className} onClick={onClick}>{label}<input
          {...props}
          ref={(input) => { if (input) input.indeterminate = Boolean(indeterminate); }}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        /></label>
      ),
      CodePatchView: TestCodePatchView,
      FileContextMenu: () => null,
      FileIcon: ({ className }) => <span aria-hidden="true" className={className} />,
      FindingMarkdown: TestFindingMarkdown,
    },
  }), [bridge, locale]);
  return <ReviewRendererHostProvider host={host}>{children}</ReviewRendererHostProvider>;
}

function TestCodePatchView({
  className,
  layout = 'unified',
  lineAnnotations,
  onPostRender,
  patch,
  wrap = false,
}: ReviewCodePatchViewProps) {
  if (typeof window === 'undefined') return <pre className={className}><code>{patch}</code></pre>;
  return (
    <FileDiff
      className={className}
      disableWorkerPool
      fileDiff={getSingularPatch(patch)}
      lineAnnotations={lineAnnotations}
      options={{
        diffIndicators: 'bars',
        diffStyle: layout,
        disableFileHeader: true,
        hunkSeparators: 'line-info',
        lineDiffType: 'none',
        lineHoverHighlight: 'both',
        onPostRender,
        overflow: wrap ? 'wrap' : 'scroll',
      }}
      renderAnnotation={(annotation) => annotation.metadata}
    />
  );
}

function TestFindingMarkdown({
  content,
  onOpenWorkspaceFile,
}: ReviewFindingMarkdownProps) {
  const linkPattern = /\[([^\]]+)\]\(([^):]+):(\d+)\)/gu;
  const children: ReactNode[] = [];
  let offset = 0;
  for (const match of content.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    children.push(content.slice(offset, index));
    const [, label = '', path = '', line = '1'] = match;
    children.push(createElement('a', {
      href: `${path}:${line}`,
      key: `${path}:${line}:${index}`,
      onClick: (event: { preventDefault(): void }) => {
        event.preventDefault();
        onOpenWorkspaceFile(path, Number(line));
      },
    }, label));
    offset = index + match[0].length;
  }
  children.push(content.slice(offset));
  return <>{children}</>;
}

function testDiffPatch(file: DesktopDiffFile): string {
  const path = file.path.replace(/[\r\n]/gu, '');
  const lines = file.lines.filter((line) => line.type !== 'gap');
  const directOldStart = lines.find((line) => line.oldLine !== undefined)?.oldLine;
  const directNewStart = lines.find((line) => line.newLine !== undefined)?.newLine;
  const oldStart = directOldStart ?? Math.max(0, (directNewStart ?? 1) - 1);
  const newStart = directNewStart ?? Math.max(0, (directOldStart ?? 1) - 1);
  const oldCount = lines.filter((line) => line.type !== 'added').length;
  const newCount = lines.filter((line) => line.type !== 'removed').length;
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...lines.map((line) => `${line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}${line.content}`),
  ].join('\n');
}
