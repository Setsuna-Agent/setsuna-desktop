import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { desktopProcessEnvironment, desktopShellPath, parseNullSeparatedEnvironment } from './desktop-environment.js';

describe('desktop environment', () => {
  it('parses null-separated login shell environment after the marker', () => {
    const parsed = parseNullSeparatedEnvironment(
      'shell startup noise\n__SETSUNA_DESKTOP_LOGIN_SHELL_ENV__\0PATH=/opt/homebrew/bin:/usr/bin\0FOO=bar=baz\0bad-key=value\0',
    );

    expect(parsed).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin',
      FOO: 'bar=baz',
    });
  });

  it('merges login shell PATH with the desktop fallback PATH', () => {
    const env = desktopProcessEnvironment(
      { PATH: '/usr/bin:/bin', SETSUNA_DESKTOP_RUNTIME_ENTRY: 'dev-entry' },
      { PATH: '/opt/homebrew/bin:/usr/local/bin', CUSTOM_ENV: 'from-shell' },
    );
    const pathEntries = String(env.PATH).split(path.delimiter);

    expect(env.CUSTOM_ENV).toBe('from-shell');
    expect(env.SETSUNA_DESKTOP_RUNTIME_ENTRY).toBe('dev-entry');
    expect(pathEntries.indexOf('/opt/homebrew/bin')).toBeLessThan(pathEntries.indexOf('/usr/bin'));
    expect(pathEntries.filter((entry) => entry === '/opt/homebrew/bin')).toHaveLength(1);
    expect(pathEntries).toContain(path.join(homedir(), '.volta', 'bin'));
  });

  it('deduplicates desktop shell PATH entries', () => {
    const pathEntries = desktopShellPath('/usr/bin:/usr/bin:/opt/homebrew/bin').split(path.delimiter);

    expect(pathEntries.filter((entry) => entry === '/usr/bin')).toHaveLength(1);
    expect(pathEntries.filter((entry) => entry === '/opt/homebrew/bin')).toHaveLength(1);
  });
});
