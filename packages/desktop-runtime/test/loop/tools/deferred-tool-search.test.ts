import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildDeferredToolSearchText,
  DeferredToolSearchIndex,
  TOOL_SEARCH_MAX_RESULTS,
  type DeferredToolSearchEntry,
} from '../../../src/loop/tools/deferred-tool-search.js';

const DEFAULTS = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

function entry(name: string, description: string, catalogOrder: number, aliases?: string[]): DeferredToolSearchEntry {
  const tool: RuntimeToolDefinition = { name, description, inputSchema: DEFAULTS };
  return {
    name,
    searchText: buildDeferredToolSearchText(tool, aliases),
    definition: tool,
    catalogOrder,
  };
}

const BROWSER_TOOLS = [
  entry('open_browser', 'Open a website in a new application side-browser tab.', 0, ['open url']),
  entry('browser_snapshot', 'Read visible page text and interactive elements.', 1),
  entry('browser_click', 'Click an element from the latest browser_snapshot.', 2),
];
const SHELL_TOOLS = [
  entry('run_shell_command', 'Run a foreground shell command inside the local workspace.', 3, ['shell', 'terminal']),
  entry('read_shell_process', 'Read buffered output and status for a still-running shell process.', 4),
];
const GIT_TOOLS = [
  entry('git_status', 'Show read-only Git branch and status information.', 5, ['git']),
  entry('git_log', 'List commits that affect the selected workspace.', 6),
];

describe('deferred tool search index', () => {
  it('indexes concrete tools only; group names are never returned', () => {
    const index = new DeferredToolSearchIndex([...BROWSER_TOOLS, ...SHELL_TOOLS, ...GIT_TOOLS]);
    const results = index.search('browser');
    expect(results.map((result) => result.name).sort()).toEqual([
      'browser_click',
      'browser_snapshot',
      'open_browser',
    ]);
    // 不存在名为 browser/shell/git 的组条目。
    expect(index.has('browser')).toBe(false);
    expect(index.has('shell')).toBe(false);
    expect(index.has('git')).toBe(false);
  });

  it('prioritizes an exact tool-name match over BM25 scores', () => {
    const index = new DeferredToolSearchIndex([
      ...BROWSER_TOOLS,
      entry('read_tool_result', 'Read a truncated tool result.', 7),
    ]);
    const results = index.search('read_tool_result');
    expect(results[0].name).toBe('read_tool_result');
    expect(results[0].description).toBe('Read a truncated tool result.');
  });

  it('matches aliases and description terms with deterministic ordering', () => {
    const index = new DeferredToolSearchIndex([...SHELL_TOOLS, ...GIT_TOOLS, ...BROWSER_TOOLS]);
    const shellHits = index.search('shell');
    expect(shellHits.map((result) => result.name)).toContain('run_shell_command');
    const terminalHits = index.search('terminal');
    expect(terminalHits[0].name).toBe('run_shell_command');
    const gitHits = index.search('git');
    expect(gitHits.map((result) => result.name)).toEqual(['git_status', 'git_log']);
  });

  it('breaks ties by global catalog order', () => {
    const index = new DeferredToolSearchIndex([
      entry('read_file', 'Read a UTF-8 text file from the local workspace.', 0),
      entry('find_files', 'Find workspace files by file name or path.', 1),
    ]);
    const results = index.search('file');
    // 两个工具都命中 “file”,按 catalogOrder 排序。
    expect(results.map((result) => result.name)).toEqual(['read_file', 'find_files']);
  });

  it('caps results and returns nothing for empty queries', () => {
    const index = new DeferredToolSearchIndex(BROWSER_TOOLS);
    expect(index.search('   ')).toEqual([]);
    expect(index.search('browser', 2).length).toBeLessThanOrEqual(TOOL_SEARCH_MAX_RESULTS);
    expect(index.search('browser', 2).length).toBe(2);
  });
});
