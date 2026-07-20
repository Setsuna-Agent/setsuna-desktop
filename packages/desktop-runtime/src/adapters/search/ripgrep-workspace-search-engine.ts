import { spawn, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type {
  WorkspaceSearchEngine,
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResponse,
} from '../../ports/workspace-search-engine.js';
import { WorkspaceSearchCancelledError } from '../../ports/workspace-search-engine.js';
import {
  isWorkspaceSearchPathExcluded,
  MAX_WORKSPACE_SEARCH_FILE_BYTES,
  resolveWorkspaceSearchScope,
  ripgrepExcludeGlobs,
  workspaceRelativeSearchPath,
  workspaceSearchIgnoreFiles,
} from './workspace-search-policy.js';
import { WorkspaceSearchSupersessionCoordinator } from './workspace-search-supersession.js';

const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;
const MAX_STDERR_BYTES = 32 * 1024;
const MAX_JSON_LINE_BYTES = 2 * 1024 * 1024;

type RipgrepWorkspaceSearchEngineOptions = {
  executablePath: string;
  fallback?: WorkspaceSearchEngine;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
};

type RipgrepMatch = Omit<WorkspaceTextSearchMatch, 'before' | 'beforeStart' | 'after'>;
type RipgrepChildProcess = ChildProcessByStdio<null, Readable, Readable>;

/** Runs cancellable rg processes and parses bounded JSONL output incrementally. */
export class RipgrepWorkspaceSearchEngine implements WorkspaceSearchEngine {
  private readonly supersession = new WorkspaceSearchSupersessionCoordinator();

  constructor(private readonly options: RipgrepWorkspaceSearchEngineOptions) {}

  async search(request: WorkspaceTextSearchRequest): Promise<WorkspaceTextSearchResponse> {
    const lease = this.supersession.start(request);
    const { controller } = lease;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    const timeout = setTimeout(
      () => controller.abort(new Error(`Workspace search timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );

    try {
      return await runRipgrepSearch(this.options, { ...request, signal: controller.signal });
    } catch (error) {
      if (this.options.fallback && isUnavailableExecutableError(error) && !controller.signal.aborted) {
        return this.options.fallback.search({ ...request, signal: controller.signal });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      lease.dispose();
    }
  }
}

export function buildRipgrepArguments(input: {
  request: WorkspaceTextSearchRequest;
  root: string;
  scopePath: string;
  ignoreFiles?: readonly string[];
}): string[] {
  const { request, root, scopePath } = input;
  const args = [
    '--json',
    '--no-config',
    '--no-ignore',
    '--hidden',
    '--max-filesize',
    String(MAX_WORKSPACE_SEARCH_FILE_BYTES),
  ];
  if (!request.caseSensitive) args.push('--ignore-case');
  if (!request.regex) args.push('--fixed-strings');
  if (request.contextLines) args.push('--context', String(request.contextLines));
  for (const ignoreFile of input.ignoreFiles ?? []) args.push('--ignore-file', ignoreFile);
  for (const glob of ripgrepExcludeGlobs(root, request.excludeRoots, request.excludeGlobs)) {
    args.push('--glob', `!${glob}`);
  }
  const relativeScope = path.relative(root, scopePath);
  args.push('--regexp', request.query, '--', relativeScope || '.');
  return args;
}

async function runRipgrepSearch(
  options: RipgrepWorkspaceSearchEngineOptions,
  request: WorkspaceTextSearchRequest,
): Promise<WorkspaceTextSearchResponse> {
  if (request.signal?.aborted) throw abortReason(request.signal);
  const scope = await resolveWorkspaceSearchScope(request.root, request.scopePath);
  if (request.signal?.aborted) throw abortReason(request.signal);
  const ignoreFiles = await workspaceSearchIgnoreFiles(scope.root);
  if (request.signal?.aborted) throw abortReason(request.signal);
  const args = buildRipgrepArguments({ request, root: scope.root, scopePath: scope.scopePath, ignoreFiles });
  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(options.executablePath, args, {
    cwd: scope.root,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return collectRipgrepResult(child, scope.root, request);
}

function collectRipgrepResult(
  child: RipgrepChildProcess,
  root: string,
  request: WorkspaceTextSearchRequest,
): Promise<WorkspaceTextSearchResponse> {
  return new Promise((resolve, reject) => {
    const matches: RipgrepMatch[] = [];
    const linesByPath = new Map<string, Map<number, string>>();
    let stdoutBuffer = '';
    let stderr = '';
    let scannedFiles: number | undefined;
    let stoppedForLimit = false;
    let fatalError: Error | null = null;
    let settled = false;

    const onAbort = () => child.kill();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (fatalError) return;
      stdoutBuffer += chunk;
      if (Buffer.byteLength(stdoutBuffer) > MAX_JSON_LINE_BYTES && !stdoutBuffer.includes('\n')) {
        fatalError = new Error('Ripgrep emitted an oversized JSON line.');
        child.kill();
        return;
      }
      const jsonLines = stdoutBuffer.split('\n');
      stdoutBuffer = jsonLines.pop() ?? '';
      for (const line of jsonLines) {
        if (!line) continue;
        if (Buffer.byteLength(line) > MAX_JSON_LINE_BYTES) {
          fatalError = new Error('Ripgrep emitted an oversized JSON line.');
          child.kill();
          break;
        }
        try {
          const event = parseRipgrepJsonLine(line);
          if (!event) continue;
          if (event.type === 'summary') {
            scannedFiles = event.scannedFiles;
            continue;
          }
          const relativePath = workspaceRelativeSearchPath(root, event.path);
          if (isWorkspaceSearchPathExcluded(root, path.join(root, relativePath), request.excludeRoots, request.excludeGlobs)) {
            continue;
          }
          const fileLines = linesByPath.get(relativePath) ?? new Map<number, string>();
          fileLines.set(event.lineNumber, event.line);
          linesByPath.set(relativePath, fileLines);
          if (event.type !== 'match') continue;
          if (matches.length >= request.maxResults) {
            stoppedForLimit = true;
            child.kill();
            break;
          }
          matches.push({
            path: relativePath,
            lineNumber: event.lineNumber,
            column: event.column,
            line: event.line,
          });
        } catch (error) {
          fatalError = error instanceof Error ? error : new Error(String(error));
          child.kill();
          break;
        }
      }
    });
    child.stderr.on('data', (chunk: string) => {
      if (Buffer.byteLength(stderr) >= MAX_STDERR_BYTES) return;
      stderr = `${stderr}${chunk}`.slice(0, MAX_STDERR_BYTES);
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (exitCode, signal) => finish(() => {
      if (request.signal?.aborted) {
        reject(abortReason(request.signal));
        return;
      }
      if (fatalError) {
        reject(fatalError);
        return;
      }
      if (!stoppedForLimit && stdoutBuffer.trim()) {
        try {
          const event = parseRipgrepJsonLine(stdoutBuffer);
          if (event?.type === 'summary') scannedFiles = event.scannedFiles;
        } catch (error) {
          reject(error);
          return;
        }
      }
      if (!stoppedForLimit && exitCode !== 0 && exitCode !== 1) {
        const detail = stderr.trim() || `signal=${signal ?? 'none'}`;
        reject(new Error(`Ripgrep search failed with exit code ${exitCode ?? 'unknown'}: ${detail}`));
        return;
      }
      resolve({
        query: request.query,
        matches: matches.map((match) => withContext(match, linesByPath.get(match.path), request.contextLines)),
        truncated: stoppedForLimit,
        engine: 'ripgrep',
        ...(scannedFiles === undefined ? {} : { scannedFiles }),
      });
    }));

    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      request.signal?.removeEventListener('abort', onAbort);
      action();
    }
  });
}

export function parseRipgrepJsonLine(line: string):
  | { type: 'match'; path: string; lineNumber: number; column: number; line: string }
  | { type: 'context'; path: string; lineNumber: number; line: string }
  | { type: 'summary'; scannedFiles?: number }
  | null {
  const event = JSON.parse(line) as {
    type?: string;
    data?: {
      path?: { text?: string; bytes?: string };
      lines?: { text?: string; bytes?: string };
      line_number?: number;
      submatches?: Array<{ start?: number }>;
      stats?: { searches?: number };
    };
  };
  if (event.type === 'summary') {
    const searches = event.data?.stats?.searches;
    return { type: 'summary', ...(Number.isSafeInteger(searches) ? { scannedFiles: searches } : {}) };
  }
  if (event.type !== 'match' && event.type !== 'context') return null;
  const eventPath = ripgrepJsonText(event.data?.path);
  const lineText = ripgrepJsonText(event.data?.lines).replace(/\r?\n$/u, '');
  const lineNumber = event.data?.line_number;
  if (!eventPath || !Number.isSafeInteger(lineNumber) || Number(lineNumber) < 1) {
    throw new Error('Ripgrep emitted an invalid path or line number.');
  }
  if (event.type === 'context') return { type: 'context', path: eventPath, lineNumber: Number(lineNumber), line: lineText };
  const byteOffset = event.data?.submatches?.[0]?.start;
  const column = Number.isSafeInteger(byteOffset) && Number(byteOffset) >= 0
    ? Buffer.from(lineText, 'utf8').subarray(0, Number(byteOffset)).toString('utf8').length + 1
    : 1;
  return { type: 'match', path: eventPath, lineNumber: Number(lineNumber), column, line: lineText };
}

function ripgrepJsonText(value?: { text?: string; bytes?: string }): string {
  if (typeof value?.text === 'string') return value.text;
  if (typeof value?.bytes === 'string') return Buffer.from(value.bytes, 'base64').toString('utf8');
  return '';
}

function withContext(
  match: RipgrepMatch,
  lines: Map<number, string> | undefined,
  contextLines: number,
): WorkspaceTextSearchMatch {
  const beforeStart = Math.max(1, match.lineNumber - contextLines);
  const before = [];
  const after = [];
  for (let lineNumber = beforeStart; lineNumber < match.lineNumber; lineNumber += 1) {
    const line = lines?.get(lineNumber);
    if (line !== undefined) before.push(line);
  }
  for (let lineNumber = match.lineNumber + 1; lineNumber <= match.lineNumber + contextLines; lineNumber += 1) {
    const line = lines?.get(lineNumber);
    if (line !== undefined) after.push(line);
  }
  return { ...match, before, beforeStart: before.length ? match.lineNumber - before.length : 0, after };
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new WorkspaceSearchCancelledError();
}

function isUnavailableExecutableError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'EACCES' || code === 'ENOEXEC';
}
