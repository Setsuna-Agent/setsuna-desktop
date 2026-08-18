import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JavaScriptWorkspaceSearchEngine } from '../../../src/adapters/search/javascript-workspace-search-engine.js';
import { createWorkspaceIgnoreMatcher } from '../../../src/adapters/tool/file-mentions.js';

describe('JavaScriptWorkspaceSearchEngine', () => {
  it('applies ignore, hidden-file, unicode, and symlink policy consistently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-js-search-'));
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
    await Promise.all([
      mkdir(path.join(root, '.github'), { recursive: true }),
      mkdir(path.join(root, 'src'), { recursive: true }),
    ]);
    await Promise.all([
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
      '.env',
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

  it('bounds pathological regular expression evaluation per file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-js-search-regex-timeout-'));
    await writeFile(path.join(root, 'input.txt'), `${'a'.repeat(40)}!\n`);

    const search = new JavaScriptWorkspaceSearchEngine().search({
      root,
      query: '^(a+)+$',
      regex: true,
      caseSensitive: true,
      contextLines: 0,
      maxResults: 20,
    });

    await expect(search).rejects.toThrow('Regular expression exceeded 100ms');
  });

  it('include-ignored searches lift traversal defaults and workspace ignore files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-js-search-include-ignored-'));
    await Promise.all([
      mkdir(path.join(root, '.git'), { recursive: true }),
      mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true }),
      mkdir(path.join(root, 'dist'), { recursive: true }),
      mkdir(path.join(root, 'src'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, '.gitignore'), 'dist/\n'),
      writeFile(path.join(root, '.setsunaignore'), 'custom-ignored.txt\n'),
      writeFile(path.join(root, '.env'), 'NEEDLE=secret\n'),
      writeFile(path.join(root, '.git', 'config'), 'NEEDLE git metadata\n'),
      writeFile(path.join(root, 'custom-ignored.txt'), 'NEEDLE custom ignored\n'),
      writeFile(path.join(root, 'src', 'app.ts'), 'NEEDLE source\n'),
      writeFile(path.join(root, 'node_modules', 'dep', 'index.js'), 'NEEDLE dependency\n'),
      writeFile(path.join(root, 'dist', 'bundle.js'), 'NEEDLE generated\n'),
    ]);
    const engine = new JavaScriptWorkspaceSearchEngine();

    const defaultSearch = await engine.search({
      root,
      query: 'NEEDLE',
      regex: true,
      caseSensitive: true,
      contextLines: 0,
      maxResults: 20,
    });
    const includeIgnoredSearch = await engine.search({
      root,
      query: 'NEEDLE',
      regex: true,
      caseSensitive: true,
      contextLines: 0,
      maxResults: 20,
      includeIgnored: true,
    });
    const explicitlyScopedIgnoredSearch = await engine.search({
      root,
      query: 'NEEDLE',
      regex: true,
      caseSensitive: true,
      contextLines: 0,
      maxResults: 20,
      includeIgnored: true,
      scopePath: path.join(root, 'custom-ignored.txt'),
    });

    expect(defaultSearch.matches.map((match) => match.path).sort()).toEqual(['.env', 'src/app.ts']);
    expect(includeIgnoredSearch.matches.map((match) => match.path).sort()).toEqual([
      '.env',
      '.git/config',
      'custom-ignored.txt',
      'dist/bundle.js',
      'node_modules/dep/index.js',
      'src/app.ts',
    ]);
    expect(explicitlyScopedIgnoredSearch.matches).toHaveLength(1);
  });

  it('requires ignored parent directories to be reincluded before their children', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-js-search-ignore-parent-'));
    await writeFile(path.join(root, '.setsunaignore'), [
      'vault/',
      '!vault/token.txt',
      'open-vault/',
      '!open-vault/',
      '!open-vault/token.txt',
      '',
    ].join('\n'));

    const matcher = await createWorkspaceIgnoreMatcher(root);

    expect(matcher.ignores('vault/token.txt')).toBe(true);
    expect(matcher.ignores('open-vault/token.txt')).toBe(false);
  });

  it.runIf(process.platform === 'win32')(
    'matches workspace ignore rules case-insensitively on Windows',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'setsuna-js-search-ignore-case-'));
      await mkdir(path.join(root, 'src'), { recursive: true });
      await Promise.all([
        writeFile(path.join(root, '.setsunaignore'), 'ignored.txt\n'),
        writeFile(path.join(root, 'src', 'Ignored.txt'), 'NEEDLE ignored\n'),
      ]);

      const result = await new JavaScriptWorkspaceSearchEngine().search({
        root,
        query: 'NEEDLE',
        regex: false,
        caseSensitive: true,
        contextLines: 0,
        maxResults: 20,
      });

      expect(result.matches).toEqual([]);
    },
  );

  it('parses UTF-8 BOMs and significant spaces in workspace ignore patterns', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-js-search-ignore-spaces-'));
    await writeFile(path.join(root, '.setsunaignore'), [
      '\uFEFF leading-secret.txt',
      'trailing-secret.txt\\ ',
      'ordinary-trailing-spaces.txt   ',
      '',
    ].join('\n'));

    const matcher = await createWorkspaceIgnoreMatcher(root);

    expect(matcher.ignores(' leading-secret.txt')).toBe(true);
    expect(matcher.ignores('leading-secret.txt')).toBe(false);
    expect(matcher.ignores('trailing-secret.txt ')).toBe(true);
    expect(matcher.ignores('trailing-secret.txt')).toBe(false);
    expect(matcher.ignores('ordinary-trailing-spaces.txt')).toBe(true);
  });

});
