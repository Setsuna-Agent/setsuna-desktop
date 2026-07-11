import type { RuntimeToolDefinition, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { ToolExecutionContext, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';
import type { WorkspaceProjectStore } from '../../ports/workspace-project-store.js';
import { objectInput, requiredContentArg, requiredStringArg, stringArg } from './tool-input.js';

type WorkspaceFileDiffLine = {
  type: 'added' | 'removed' | 'context' | 'gap';
  lineNumber: number;
  oldLine?: number;
  newLine?: number;
  content: string;
};

type WorkspaceFileChangePreview = {
  path: string;
  action: 'Created' | 'Modified';
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: WorkspaceFileDiffLine[];
};

const MAX_FILE_DIFF_LINES = 240;
const FILE_DIFF_CONTEXT_LINES = 3;

export class WorkspaceToolHost implements ToolHost {
  constructor(private readonly projects: WorkspaceProjectStore) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'workspace_list_directory',
        description: 'List files and folders in the active local project workspace.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string', description: 'Optional local project id. Defaults to the current project thread, then the first registered project.' },
            path: { type: 'string', description: 'Directory path relative to the project root. Defaults to ".".' },
          },
        },
      },
      {
        name: 'workspace_read_file',
        description: 'Read a UTF-8 text file from the active local project workspace.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string', description: 'Optional local project id. Defaults to the current project thread, then the first registered project.' },
            path: { type: 'string', description: 'File path relative to the project root.' },
          },
          required: ['path'],
        },
      },
      {
        name: 'workspace_search_text',
        description: 'Search text in files under the active local project workspace.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string', description: 'Optional local project id. Defaults to the current project thread, then the first registered project.' },
            query: { type: 'string', description: 'Text to search for.' },
          },
          required: ['query'],
        },
      },
      {
        name: 'workspace_write_file',
        description: 'Write a UTF-8 text file inside the active local project workspace.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string', description: 'Optional local project id. Defaults to the current project thread, then the first registered project.' },
            path: { type: 'string', description: 'File path relative to the project root.' },
            content: { type: 'string', description: 'Complete UTF-8 file content to write.' },
          },
          required: ['path', 'content'],
        },
      },
    ];
  }

  async approvalForTool(name: string, input: unknown, context: ToolExecutionContext): Promise<{ reason: string; argumentsPreview?: string } | null> {
    if (name !== 'workspace_write_file') return null;
    void input;
    void context;
    return null;
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const args = objectInput(input);
    const project = await this.projectFor(this.resolveProjectId(args.projectId, context));

    if (name === 'workspace_list_directory') {
      const result = await this.projects.listEntries(project.id, stringArg(args.path, '.'));
      return {
        content: result.entries.map((entry) => `${entry.type === 'directory' ? 'dir ' : 'file'} ${entry.path}`).join('\n') || '(empty)',
        data: result,
      };
    }

    if (name === 'workspace_read_file') {
      const filePath = requiredStringArg(args.path, 'path');
      const result = await this.projects.readFile(project.id, filePath);
      return {
        content: result.truncated ? `${result.content}\n\n[truncated at ${result.content.length} chars]` : result.content,
        data: result,
      };
    }

    if (name === 'workspace_search_text') {
      const query = requiredStringArg(args.query, 'query');
      const result = await this.projects.search(project.id, query);
      return {
        content:
          result.results.map((item) => `${item.path}:${item.line}: ${item.preview}`).join('\n') ||
          `No matches for ${JSON.stringify(query)}.`,
        data: result,
      };
    }

    if (name === 'workspace_write_file') {
      if (context.permissionProfile === 'read-only') {
        throw new Error('The current permission profile is read-only, so workspace files cannot be modified.');
      }
      const filePath = requiredStringArg(args.path, 'path');
      const content = requiredContentArg(args.content);
      const previous = await this.projects.readFile(project.id, filePath).catch(() => null);
      const result = await this.projects.writeFile(project.id, filePath, content);
      const diff = fileChangePreview({
        created: result.created,
        nextContent: content,
        path: normalizeDisplayPath(result.path),
        previousContent: previous?.content ?? null,
        previousTruncated: Boolean(previous?.truncated),
      });
      return {
        content: `${result.created ? 'Created' : 'Updated'} ${diff.path} (${result.size} bytes).`,
        preview: JSON.stringify({ diff }),
        data: { ...result, diff },
      };
    }

    throw new Error(`Unknown workspace tool: ${name}`);
  }

  private resolveProjectId(projectId: unknown, context: ToolExecutionContext): string | undefined {
    return typeof projectId === 'string' && projectId ? projectId : context.projectId;
  }

  private async projectFor(projectId: unknown): Promise<WorkspaceProject> {
    const status = await this.projects.getStatus(typeof projectId === 'string' && projectId ? projectId : undefined);
    if (!status.project) throw new Error('No workspace is available for workspace tools.');
    return status.project;
  }
}

function fileChangePreview({
  created,
  nextContent,
  path,
  previousContent,
  previousTruncated,
}: {
  created: boolean;
  nextContent: string;
  path: string;
  previousContent: string | null;
  previousTruncated: boolean;
}): WorkspaceFileChangePreview {
  const beforeLines = created || previousContent === null ? [] : splitFileLines(previousContent);
  const afterLines = splitFileLines(nextContent);
  const { additions, deletions, lines, truncated } = lineDiffPreview(beforeLines, afterLines);
  return {
    path,
    action: created ? 'Created' : 'Modified',
    additions,
    deletions,
    truncated: previousTruncated || truncated,
    lines,
  };
}

function lineDiffPreview(beforeLines: string[], afterLines: string[]): Pick<WorkspaceFileChangePreview, 'additions' | 'deletions' | 'lines' | 'truncated'> {
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const beforeChangedEnd = beforeLines.length - suffix;
  const afterChangedEnd = afterLines.length - suffix;
  const additions = Math.max(0, afterChangedEnd - prefix);
  const deletions = Math.max(0, beforeChangedEnd - prefix);
  const lines: WorkspaceFileDiffLine[] = [];
  let lineNumber = 1;

  const push = (line: Omit<WorkspaceFileDiffLine, 'lineNumber'>) => {
    if (lines.length >= MAX_FILE_DIFF_LINES) return;
    lines.push({ ...line, lineNumber });
    lineNumber += 1;
  };

  const leadingContextStart = Math.max(0, prefix - FILE_DIFF_CONTEXT_LINES);
  for (let index = leadingContextStart; index < prefix; index += 1) {
    push({ type: 'context', oldLine: index + 1, newLine: index + 1, content: beforeLines[index] ?? '' });
  }

  for (let index = prefix; index < beforeChangedEnd; index += 1) {
    push({ type: 'removed', oldLine: index + 1, content: beforeLines[index] ?? '' });
  }

  for (let index = prefix; index < afterChangedEnd; index += 1) {
    push({ type: 'added', newLine: index + 1, content: afterLines[index] ?? '' });
  }

  const trailingCount = Math.min(FILE_DIFF_CONTEXT_LINES, suffix);
  const beforeTrailingStart = beforeChangedEnd;
  const afterTrailingStart = afterChangedEnd;
  for (let offset = 0; offset < trailingCount; offset += 1) {
    push({
      type: 'context',
      oldLine: beforeTrailingStart + offset + 1,
      newLine: afterTrailingStart + offset + 1,
      content: afterLines[afterTrailingStart + offset] ?? '',
    });
  }

  const leadingContextCount = prefix - leadingContextStart;
  const totalPotentialLines = leadingContextCount + deletions + additions + trailingCount;
  return {
    additions,
    deletions,
    lines,
    truncated: totalPotentialLines > MAX_FILE_DIFF_LINES,
  };
}

function splitFileLines(value: string): string[] {
  if (!value) return [];
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function normalizeDisplayPath(value: string): string {
  return value.replace(/\\/g, '/');
}
