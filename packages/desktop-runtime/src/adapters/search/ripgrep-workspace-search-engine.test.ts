import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceTextSearchRequest } from '../../ports/workspace-search-engine.js';
import {
  buildRipgrepArguments,
  parseRipgrepJsonLine,
  RipgrepWorkspaceSearchEngine,
} from './ripgrep-workspace-search-engine.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const builderOs = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform;
const preparedRipgrepPath = path.join(
  repositoryRoot,
  '.cache',
  'ripgrep',
  `${builderOs}-${process.arch}`,
  process.platform === 'win32' ? 'rg.exe' : 'rg',
);

describe('RipgrepWorkspaceSearchEngine', () => {
  it('builds a config-independent traversal command with explicit ignore policy', () => {
    const root = path.resolve('/workspace');
    const args = buildRipgrepArguments({
      root,
      scopePath: path.join(root, 'src'),
      ignoreFiles: [path.join(root, '.setsunaignore')],
      request: request(root, {
        scopePath: path.join(root, 'src'),
        regex: false,
        excludeRoots: ['blocked'],
      }),
    });

    expect(args).toEqual(expect.arrayContaining([
      '--json',
      '--no-config',
      '--hidden',
      '--fixed-strings',
      '--ignore-file',
      path.join(root, '.setsunaignore'),
      '--glob',
      '!**/.env',
      '--glob',
      '!/blocked/**',
    ]));
    expect(args.slice(-4)).toEqual(['--regexp', 'needle', '--', 'src']);
    expect(args).not.toContain('--follow');
  });

  it('parses UTF-8 byte offsets into character columns', () => {
    const line = '前缀 needle\n';
    const parsed = parseRipgrepJsonLine(JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'src/你好.ts' },
        lines: { text: line },
        line_number: 4,
        submatches: [{ start: Buffer.byteLength('前缀 ') }],
      },
    }));

    expect(parsed).toEqual({
      type: 'match',
      path: 'src/你好.ts',
      lineNumber: 4,
      column: 4,
      line: '前缀 needle',
    });
  });

  it('cancels the previous process when a new search starts for the same workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-rg-cancel-'));
    const children: FakeRipgrepChild[] = [];
    const spawnProcess = vi.fn(() => {
      const child = new FakeRipgrepChild();
      children.push(child);
      return child as never;
    });
    const engine = new RipgrepWorkspaceSearchEngine({
      executablePath: '/bundled/rg',
      spawnProcess: spawnProcess as never,
    });

    const first = engine.search(request(root)).catch((error: unknown) => error);
    await waitFor(() => children.length === 1);
    const second = engine.search(request(root));
    await waitFor(() => children.length === 2);
    children[1].stdout.write(`${JSON.stringify({ type: 'summary', data: { stats: { searches: 0 } } })}\n`);
    children[1].emit('close', 1, null);

    await expect(first).resolves.toMatchObject({ message: 'Workspace search was superseded.' });
    await expect(second).resolves.toMatchObject({ matches: [], engine: 'ripgrep' });
    expect(children[0].kill).toHaveBeenCalledTimes(1);
  });

  it.runIf(existsSync(preparedRipgrepPath))(
    'searches with the real pinned sidecar while honoring ignore, hidden, secret, symlink, and global-cap rules',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'setsuna-rg-integration-'));
      const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
      await Promise.all([
        mkdir(path.join(root, '.github'), { recursive: true }),
        mkdir(path.join(root, 'src'), { recursive: true }),
        writeFile(path.join(root, '.gitignore'), 'ignored.txt\n'),
        writeFile(path.join(root, '.setsunaignore'), 'custom-secret.txt\n'),
        writeFile(path.join(root, '.env'), 'NEEDLE=secret\n'),
        writeFile(path.join(root, '.github', 'workflow.yml'), 'name: NEEDLE hidden source\n'),
        writeFile(path.join(root, 'ignored.txt'), 'NEEDLE ignored\n'),
        writeFile(path.join(root, 'custom-secret.txt'), 'NEEDLE ignored custom\n'),
        writeFile(path.join(root, 'src', '你好.ts'), 'NEEDLE one\nNEEDLE two\n'),
        writeFile(outside, 'NEEDLE outside\n'),
      ]);
      if (process.platform !== 'win32') await symlink(outside, path.join(root, 'linked.txt'));
      const engine = new RipgrepWorkspaceSearchEngine({ executablePath: preparedRipgrepPath });

      const all = await engine.search(request(root, { maxResults: 20, regex: false }));
      const limited = await engine.search(request(root, { maxResults: 1, regex: false }));

      expect(all.engine).toBe('ripgrep');
      expect([...new Set(all.matches.map((match) => match.path))].sort()).toEqual([
        '.github/workflow.yml',
        'src/你好.ts',
      ]);
      expect(all.matches.filter((match) => match.path === 'src/你好.ts')).toHaveLength(2);
      expect(limited.matches).toHaveLength(1);
      expect(limited.truncated).toBe(true);
    },
  );
});

class FakeRipgrepChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => {
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
    return true;
  });
}

function request(root: string, overrides: Partial<WorkspaceTextSearchRequest> = {}): WorkspaceTextSearchRequest {
  return {
    root,
    query: 'needle',
    regex: true,
    caseSensitive: false,
    contextLines: 0,
    maxResults: 20,
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not met in time.');
}
