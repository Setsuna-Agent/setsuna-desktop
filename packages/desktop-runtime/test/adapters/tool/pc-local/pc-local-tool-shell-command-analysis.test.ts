import { describe, expect, it } from 'vitest';
import {
  codexDangerousShellReason,
  obviousHighRiskShellReason,
  shellWritePathCandidates,
} from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-command-analysis.js';

describe('PC local shell destructive-command analysis', () => {
  it('matches Codex dangerous deletion commands when approval prompts are disabled', () => {
    for (const command of [
      'rm -f scoped.txt',
      '/bin/rm --force scoped.txt',
      'sudo rm -rf scoped-dir',
      'env CI=1 rm -fr scoped-dir',
      'sh -lc "rm -rf scoped-dir"',
      String.raw`powershell -Command "Remove-Item C:\repo\dist -Force -Recurse"`,
      String.raw`cmd /c del /f C:\repo\dist\*`,
      String.raw`cmd /c rd /q /s C:\repo\dist`,
    ]) {
      expect(codexDangerousShellReason(command), command).not.toBe('');
    }
  });

  it('keeps ordinary deletion outside the Codex dangerous-command denylist', () => {
    for (const command of [
      'rm scoped.txt',
      'rm -- -f',
      String.raw`powershell -Command "Remove-Item C:\repo\old.txt"`,
      String.raw`cmd /c del /q /s C:\repo\dist\*`,
      String.raw`cmd /c rd /s C:\repo\dist`,
    ]) {
      expect(codexDangerousShellReason(command), command).toBe('');
    }
  });

  it('classifies Windows deletion commands independently of flag order and aliases', () => {
    for (const command of [
      String.raw`powershell -Command "Remove-Item C:\repo\dist -Force -Recurse"`,
      String.raw`cmd /c del /f C:\repo\dist\*`,
      String.raw`cmd /c rd /q /s C:\repo\dist`,
      String.raw`r\m -rf /some/path`,
    ]) {
      expect(obviousHighRiskShellReason(command), command).not.toBe('');
    }
  });

  it('does not broaden Windows risk classification beyond Codex-style force deletion', () => {
    for (const command of [
      String.raw`powershell -Command "Get-ChildItem C:\ -Force; Remove-Item C:\repo\old.txt"`,
      String.raw`powershell -Command "Remove-Item C:\repo\old.txt"`,
      String.raw`cmd /c del /q /s C:\repo\dist\*`,
      String.raw`cmd /c rd /s C:\repo\dist`,
      'diskpart',
      String.raw`echo "\\.\PhysicalDrive0"`,
    ]) {
      expect(obviousHighRiskShellReason(command), command).toBe('');
    }
  });

  it('preserves Windows separators when extracting shell write targets', () => {
    expect(shellWritePathCandidates(
      String.raw`powershell -Command "Remove-Item C:\outside\cache -Recurse -Force"`,
    )).toContain(String.raw`C:\outside\cache`);
  });
});
