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
  const children: ReactNode[] = [];
  let offset = 0;
  let link = findTestWorkspaceLink(content, offset);
  while (link) {
    children.push(content.slice(offset, link.start));
    const { end, label, line, path, start } = link;
    children.push(createElement('a', {
      href: `${path}:${line}`,
      key: `${path}:${line}:${start}`,
      onClick: (event: { preventDefault(): void }) => {
        event.preventDefault();
        onOpenWorkspaceFile(path, line);
      },
    }, label));
    offset = end;
    link = findTestWorkspaceLink(content, offset);
  }
  children.push(content.slice(offset));
  return <>{children}</>;
}

type TestWorkspaceLink = Readonly<{
  end: number;
  label: string;
  line: number;
  path: string;
  start: number;
}>;

/** Parses the small workspace-link subset needed by these tests in one forward pass. */
function findTestWorkspaceLink(content: string, from: number): TestWorkspaceLink | null {
  let start = content.indexOf('[', from);
  while (start >= 0) {
    const labelEnd = content.indexOf(']', start + 1);
    if (labelEnd < 0) return null;
    if (content[labelEnd + 1] !== '(') {
      start = content.indexOf('[', labelEnd + 1);
      continue;
    }

    const targetStart = labelEnd + 2;
    const targetEnd = content.indexOf(')', targetStart);
    if (targetEnd < 0) return null;
    const target = content.slice(targetStart, targetEnd);
    const separator = target.lastIndexOf(':');
    const path = target.slice(0, separator);
    const lineText = target.slice(separator + 1);
    if (separator > 0 && !path.includes(':') && isAsciiDigits(lineText)) {
      return {
        end: targetEnd + 1,
        label: content.slice(start + 1, labelEnd),
        line: Number(lineText),
        path,
        start,
      };
    }
    start = content.indexOf('[', targetEnd + 1);
  }
  return null;
}

function isAsciiDigits(value: string): boolean {
  if (!value) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 48 || code > 57) return false;
  }
  return true;
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
