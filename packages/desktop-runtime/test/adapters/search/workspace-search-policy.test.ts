import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isWorkspaceSearchPathExcluded,
  ripgrepExcludeGlobs,
  workspaceSearchDefaultExcludeGlobs,
} from '../../../src/adapters/search/workspace-search-policy.js';

describe('workspace search policy', () => {
  it('keeps hidden source paths but excludes secrets and generated directories', () => {
    const root = path.resolve('/workspace');

    expect(isWorkspaceSearchPathExcluded(root, path.join(root, '.github', 'workflow.yml'))).toBe(false);
    expect(isWorkspaceSearchPathExcluded(root, path.join(root, '.env'))).toBe(true);
    expect(isWorkspaceSearchPathExcluded(root, path.join(root, 'app', '.env.local'))).toBe(true);
    expect(isWorkspaceSearchPathExcluded(root, path.join(root, 'node_modules', 'pkg', 'index.js'))).toBe(true);
    expect(isWorkspaceSearchPathExcluded(root, path.join(root, 'certs', 'private.key'))).toBe(true);
  });

  it('include-ignored searches keep sensitive files excluded but lift generated directories', () => {
    const root = path.resolve('/workspace');
    const includeIgnoredDefaults = workspaceSearchDefaultExcludeGlobs({ includeIgnored: true });

    expect(includeIgnoredDefaults).not.toContain('**/node_modules/**');
    expect(includeIgnoredDefaults).toContain('**/.env');
    expect(includeIgnoredDefaults).toContain('**/*.key');

    expect(isWorkspaceSearchPathExcluded(
      root,
      path.join(root, 'node_modules', 'pkg', 'index.js'),
      [],
      [],
      includeIgnoredDefaults,
    )).toBe(false);
    expect(isWorkspaceSearchPathExcluded(
      root,
      path.join(root, '.env'),
      [],
      [],
      includeIgnoredDefaults,
    )).toBe(true);
    expect(isWorkspaceSearchPathExcluded(
      root,
      path.join(root, 'certs', 'private.key'),
      [],
      [],
      includeIgnoredDefaults,
    )).toBe(true);
  });

  it('ripgrep globs for include-ignored searches drop generated paths but keep secrets', () => {
    const root = path.resolve('/workspace');

    const globs = ripgrepExcludeGlobs(root, [], [], workspaceSearchDefaultExcludeGlobs({ includeIgnored: true }));

    expect(globs).not.toContain('**/node_modules/**');
    expect(globs).toEqual(expect.arrayContaining(['**/.env', '**/.env.*', '**/*.pem', '**/*.key']));
    expect(globs.some((glob) => glob.includes('node_modules'))).toBe(false);
  });

  it('normalizes relative denied roots that use Windows separators', () => {
    const root = path.resolve('/workspace');
    const deniedFile = path.join(root, 'blocked', 'nested', 'secret.txt');

    expect(isWorkspaceSearchPathExcluded(root, deniedFile, ['blocked\\nested'])).toBe(true);
    expect(ripgrepExcludeGlobs(root, ['blocked\\nested'])).toEqual(expect.arrayContaining([
      '/blocked/nested',
      '/blocked/nested/**',
    ]));
  });

  it('escapes glob metacharacters in literal denied root names', () => {
    const root = path.resolve('/workspace');

    expect(ripgrepExcludeGlobs(root, ['blocked[1]', 'literal{dir}', 'star*dir'])).toEqual(expect.arrayContaining([
      '/blocked\\[1\\]',
      '/blocked\\[1\\]/**',
      '/literal\\{dir\\}/**',
      '/star\\*dir/**',
    ]));
  });

  it('does not let unrelated absolute deny patterns hide the entire workspace', () => {
    const root = path.resolve('/workspace');

    expect(isWorkspaceSearchPathExcluded(
      root,
      path.join(root, 'src', 'index.ts'),
      [],
      [path.resolve('/another-workspace/**/*.ts')],
    )).toBe(false);
  });

  it('canonicalizes absolute deny globs that use a filesystem alias', async () => {
    const lexicalRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-policy-alias-'));
    const canonicalRoot = await realpath(lexicalRoot);
    const deniedFile = path.join(canonicalRoot, 'app', '.env');

    expect(isWorkspaceSearchPathExcluded(
      canonicalRoot,
      deniedFile,
      [],
      [path.join(lexicalRoot, '**', '*.env')],
    )).toBe(true);
  });
});
