import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  WorkspaceSearchEngine,
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResponse,
} from '../../ports/workspace-search-engine.js';
import { WorkspaceSearchCancelledError } from '../../ports/workspace-search-engine.js';
import { createWorkspaceIgnoreMatcher } from '../tool/file-mentions.js';
import {
  isWorkspaceSearchPathExcluded,
  MAX_WORKSPACE_SEARCH_FILE_BYTES,
  resolveWorkspaceSearchScope,
  workspaceRelativeSearchPath,
} from './workspace-search-policy.js';
import { WorkspaceSearchSupersessionCoordinator } from './workspace-search-supersession.js';

/** Development fallback for machines where a prepared rg is intentionally unavailable. */
export class JavaScriptWorkspaceSearchEngine implements WorkspaceSearchEngine {
  private readonly supersession = new WorkspaceSearchSupersessionCoordinator();

  async search(request: WorkspaceTextSearchRequest): Promise<WorkspaceTextSearchResponse> {
    const lease = this.supersession.start(request);
    try {
      return await runJavaScriptSearch({ ...request, signal: lease.controller.signal });
    } finally {
      lease.dispose();
    }
  }
}

async function runJavaScriptSearch(request: WorkspaceTextSearchRequest): Promise<WorkspaceTextSearchResponse> {
  throwIfAborted(request.signal);
  const scope = await resolveWorkspaceSearchScope(request.root, request.scopePath);
  throwIfAborted(request.signal);
  const matcher = createLineMatcher(request);
  const ignoreMatcher = await createWorkspaceIgnoreMatcher(scope.root);
  throwIfAborted(request.signal);
  const matches: WorkspaceTextSearchMatch[] = [];
  let scannedFiles = 0;
  let truncated = false;

  const visitFile = async (filePath: string): Promise<boolean> => {
    throwIfAborted(request.signal);
    if (isWorkspaceSearchPathExcluded(scope.root, filePath, request.excludeRoots, request.excludeGlobs)) return true;
    const relativePath = workspaceRelativeSearchPath(scope.root, filePath);
    if (ignoreMatcher.ignores(relativePath)) return true;
    const fileStat = await stat(filePath).catch(() => null);
    throwIfAborted(request.signal);
    if (!fileStat?.isFile() || fileStat.size > MAX_WORKSPACE_SEARCH_FILE_BYTES) return true;
    const content = await readFile(filePath).catch(() => null);
    throwIfAborted(request.signal);
    if (!content || isProbablyBinary(content)) return true;
    scannedFiles += 1;
    const lines = content.toString('utf8').split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const column = matcher(lines[index]);
      if (column === null) continue;
      if (matches.length >= request.maxResults) {
        truncated = true;
        return false;
      }
      matches.push(searchMatch(relativePath, lines, index, column, request.contextLines));
    }
    return true;
  };

  if (scope.scopeStat.isFile()) {
    await visitFile(scope.scopePath);
  } else {
    const stack = [scope.scopePath];
    while (stack.length) {
      throwIfAborted(request.signal);
      const directory = stack.pop()!;
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      throwIfAborted(request.signal);
      entries.sort((left, right) => right.name.localeCompare(left.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const entryPath = path.join(directory, entry.name);
        const relativePath = workspaceRelativeSearchPath(scope.root, entryPath);
        if (entry.isDirectory()) {
          if (!ignoreMatcher.shouldSkipDirectory(`${relativePath}/`)
            && !isWorkspaceSearchPathExcluded(scope.root, entryPath, request.excludeRoots, request.excludeGlobs)) {
            stack.push(entryPath);
          }
        } else if (entry.isFile() && !await visitFile(entryPath)) {
          return response(request.query, matches, truncated, scannedFiles);
        }
      }
    }
  }

  throwIfAborted(request.signal);
  return response(request.query, matches, truncated, scannedFiles);
}

function createLineMatcher(request: WorkspaceTextSearchRequest): (line: string) => number | null {
  if (request.regex) {
    let expression: RegExp;
    try {
      expression = new RegExp(request.query, request.caseSensitive ? '' : 'i');
    } catch (error) {
      throw new Error(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
    }
    return (line) => expression.exec(line)?.index ?? null;
  }
  const needle = request.caseSensitive ? request.query : request.query.toLowerCase();
  return (line) => {
    const index = (request.caseSensitive ? line : line.toLowerCase()).indexOf(needle);
    return index === -1 ? null : index;
  };
}

function searchMatch(
  relativePath: string,
  lines: string[],
  index: number,
  zeroBasedColumn: number,
  contextLines: number,
): WorkspaceTextSearchMatch {
  const beforeStartIndex = Math.max(0, index - contextLines);
  return {
    path: relativePath,
    lineNumber: index + 1,
    column: zeroBasedColumn + 1,
    line: lines[index],
    before: contextLines ? lines.slice(beforeStartIndex, index) : [],
    beforeStart: contextLines ? beforeStartIndex + 1 : 0,
    after: contextLines ? lines.slice(index + 1, index + 1 + contextLines) : [],
  };
}

function response(
  query: string,
  matches: WorkspaceTextSearchMatch[],
  truncated: boolean,
  scannedFiles: number,
): WorkspaceTextSearchResponse {
  return { query, matches, truncated, engine: 'javascript', scannedFiles };
}

function isProbablyBinary(content: Buffer): boolean {
  return content.subarray(0, 8_192).includes(0);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new WorkspaceSearchCancelledError();
}
