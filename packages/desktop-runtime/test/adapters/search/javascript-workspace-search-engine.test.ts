import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JavaScriptWorkspaceSearchEngine } from '../../../src/adapters/search/javascript-workspace-search-engine.js';

describe('JavaScriptWorkspaceSearchEngine', () => {
  it('applies ignore, hidden-file, sensitive-file, unicode, and symlink policy consistently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-js-search-'));
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
    await Promise.all([
      mkdir(path.join(root, '.github'), { recursive: true }),
      mkdir(path.join(root, 'src'), { recursive: true }),
      writeFile(path.join(root, '.gitignore'), 'ignored.txt\n'),
      writeFile(path.join(root, '.rgignore'), 'rg-only-ignore.txt\n'),
      writeFile(path.join(root, '.setsunaignore'), 'custom-secret.txt\n'),
      writeFile(path.join(root, '.env'), 'NEEDLE=secret\n'),
      writeFile(path.join(root, '.github', 'workflow.yml'), 'name: NEEDLE hidden source\n'),
      writeFile(path.join(root, 'ignored.txt'), 'NEEDLE ignored\n'),
      writeFile(path.join(root, 'rg-only-ignore.txt'), 'NEEDLE must remain searchable\n'),
      writeFile(path.join(root, 'custom-secret.txt'), 'NEEDLE custom ignored\n'),
      writeFile(path.join(root, 'src', '你好.ts'), 'before\nconst NEEDLE = true\nafter\n'),
      writeFile(outside, 'NEEDLE outside\n'),
    ]);
    if (process.platform !== 'win32') await symlink(outside, path.join(root, 'linked.txt'));
    const engine = new JavaScriptWorkspaceSearchEngine();

    const result = await engine.search({
      root,
      query: 'needle',
      regex: false,
      caseSensitive: false,
      contextLines: 1,
      maxResults: 20,
    });

    expect(result.engine).toBe('javascript');
    expect(result.matches.map((match) => match.path).sort()).toEqual([
      '.github/workflow.yml',
      'rg-only-ignore.txt',
      'src/你好.ts',
    ]);
    expect(result.matches.find((match) => match.path === 'src/你好.ts')).toMatchObject({
      lineNumber: 2,
      before: ['before'],
      after: ['after'],
    });
  });

  it('honors the global result cap and denied roots', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-js-search-limit-'));
    await mkdir(path.join(root, 'blocked', 'nested'), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, 'visible.txt'), 'match\nmatch\n'),
      writeFile(path.join(root, 'blocked', 'nested', 'secret.txt'), 'match\n'),
    ]);
    const engine = new JavaScriptWorkspaceSearchEngine();

    const result = await engine.search({
      root,
      query: 'match',
      regex: false,
      caseSensitive: true,
      contextLines: 0,
      maxResults: 1,
      excludeRoots: ['blocked\\nested'],
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.path).toBe('visible.txt');
    expect(result.truncated).toBe(true);
  });
});
