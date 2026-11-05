import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownNavigationProvider } from '../../../../../src/features/chat/markdown/MarkdownNavigationProvider.js';
import { RuntimeToolRuns, groupToolRuns } from '../../../../../src/features/chat/tool-runs/RuntimeToolRuns.js';
import { withRendererPluginTestHost } from '../../../support/RendererPluginTestHost.js';

export function toolRun(id: string, name: string, args: Record<string, unknown>, status: RuntimeToolRun['status'] = 'success'): RuntimeToolRun {
  return {
    id,
    name,
    status,
    argumentsPreview: JSON.stringify(args),
    resultPreview: name === 'run_shell_command' ? `$ ${String(args.command ?? '')}\nexit: 0` : undefined,
  };
}

export function fileRun(id: string, name: string, path: string, action: string): RuntimeToolRun {
  return {
    ...toolRun(id, name, { file_path: path }),
    resultPreview: JSON.stringify({
      diff: {
        path,
        action,
        additions: action === 'Created' ? 12 : 1,
        deletions: action === 'Created' ? 0 : 1,
        truncated: false,
        lines: [],
      },
    }),
  };
}

export function fileRunWithDiff(
  id: string,
  name: string,
  path: string,
  status: RuntimeToolRun['status'] = 'success',
): RuntimeToolRun {
  return {
    ...toolRun(id, name, { file_path: path }, status),
    resultPreview: JSON.stringify({
      diff: {
        path,
        action: 'Edited',
        additions: 1,
        deletions: 1,
        truncated: false,
        lines: [
          { type: 'context', oldLine: 1, newLine: 1, content: 'const before = true;' },
          { type: 'del', oldLine: 2, content: "return 'before';" },
          { type: 'add', newLine: 2, content: "return 'after';" },
        ],
      },
    }),
  };
}

export function groupLabel(group: ReturnType<typeof groupToolRuns>[number]): string {
  return group.type === 'group' ? `${group.kind}:${group.runs.length}` : `single:${group.run.name}`;
}

export function renderedTextFromHtml(html: string): string {
  let text = '';
  let insideTag = false;

  for (const character of html) {
    if (character === '<') {
      insideTag = true;
    } else if (character === '>') {
      insideTag = false;
    } else if (!insideTag) {
      text += character;
    }
  }

  return text.replace(/\s+/gu, ' ').trim();
}

export function renderedHtml(runs: RuntimeToolRun[], summaryMode?: 'aggregate' | 'latest'): string {
  const children = createElement(RuntimeToolRuns, { runs, summaryMode, onAnswerApproval: () => undefined });
  const html = renderToStaticMarkup(withRendererPluginTestHost(createElement(MarkdownNavigationProvider, {
    children,
    onOpenWorkspaceFile: () => undefined,
    workspaceRoot: '/Users/dev/project',
  })));
  return html;
}
