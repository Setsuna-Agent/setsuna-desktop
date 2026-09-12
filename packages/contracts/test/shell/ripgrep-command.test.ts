import { describe, expect, it } from 'vitest';
import { parseLiteralShellCommand, parseRipgrepCommand } from '../../src/index.js';

describe('literal ripgrep commands', () => {
  it('preserves patterns, quoted globs, scopes and file-based inputs', () => {
    expect(parseRipgrepCommand('rg -nC3 -g"*.ts" -e "sudo|chmod" --regexp=rm --ignore-file .setsunaignore src tests')).toEqual({
      kind: 'text', query: 'sudo|chmod | rm', paths: ['src', 'tests'],
      readPaths: ['src', 'tests', '.setsunaignore'],
    });
    expect(parseRipgrepCommand('rg --files --hidden -g "*.tsx" "src with spaces"')).toMatchObject({
      kind: 'files', query: '*.tsx', paths: ['src with spaces'],
    });
    expect(parseRipgrepCommand('rg -f patterns.txt -- -src')).toMatchObject({
      kind: 'text', query: '', paths: ['-src'], readPaths: ['-src', 'patterns.txt'],
    });
    expect(parseRipgrepCommand('rg -- "--pre" src')).toMatchObject({ query: '--pre', paths: ['src'] });
    expect(parseRipgrepCommand('rg "" src')).toMatchObject({ query: '', paths: ['src'] });
  });

  it('leaves shell programs, incomplete calls and subprocess options opaque', () => {
    for (const command of [
      'rg needle src && rm -rf target', 'rg needle src | sh', 'rg needle > output',
      'rg "$(touch marker)" src', 'rg "$PATTERN" src', 'rg needle *.ts',
      'rg needle src\nrm -f marker', 'rg "unfinished', 'rg -e', 'rg --glob',
      'rg --pre ./helper needle src', 'rg --hostname-bin=./helper needle',
      'rg --search-zip needle', 'rg -z needle', 'rg --future-option needle',
    ]) expect(parseRipgrepCommand(command), command).toBeNull();
  });

  it('uses cmd quoting without rewriting Windows paths or accepting expansions', () => {
    expect(parseRipgrepCommand(String.raw`"C:\Program Files\rg.exe" -n "sudo" "C:\repo with spaces"`, 'cmd')).toMatchObject({
      query: 'sudo', paths: [String.raw`C:\repo with spaces`],
    });
    expect(parseRipgrepCommand(String.raw`rg --files -g "*.ts" C:\repo`, 'cmd')).toMatchObject({
      kind: 'files', paths: [String.raw`C:\repo`],
    });
    for (const command of [
      "rg 'sudo & del /f marker' src", 'rg "%PATTERN%" src',
      'rg "!PATTERN!" src', 'rg needle ^& del /f marker',
      String.raw`rg needle "C:\repo\" & del /f marker`,
    ]) expect(parseRipgrepCommand(command, 'cmd'), command).toBeNull();
  });

  it('retains empty literal arguments and POSIX escapes for prefix comparisons', () => {
    expect(parseLiteralShellCommand('rg "" \'sudo|chmod\' "a\\q"')).toEqual(['rg', '', 'sudo|chmod', 'a\\q']);
    expect(parseLiteralShellCommand('rg -e\\ sudo src')).toEqual(['rg', '-e sudo', 'src']);
    expect(parseLiteralShellCommand('rg "$(echo sudo)"')).toBeNull();
  });
});
