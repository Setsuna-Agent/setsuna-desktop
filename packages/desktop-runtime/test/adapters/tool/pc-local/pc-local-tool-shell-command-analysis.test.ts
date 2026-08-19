import { describe, expect, it } from 'vitest';
import {
  catastrophicShellCommandReason,
  obviousHighRiskShellReason,
  shellWritePathCandidates,
} from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-command-analysis.js';

describe('PC local shell destructive-command analysis', () => {
  it('classifies Windows deletion commands independently of flag order and aliases', () => {
    for (const command of [
      String.raw`powershell -Command "Remove-Item C:\repo\dist -Force -Recurse"`,
      String.raw`cmd /c del /q /s C:\repo\dist\*`,
      String.raw`cmd /c rd /q /s C:\repo\dist`,
    ]) {
      expect(obviousHighRiskShellReason(command), command).toContain('Windows Shell');
    }
  });

  it('hard-blocks volume-root and disk operations but permits scoped deletion', () => {
    for (const command of [
      String.raw`powershell -Command "Remove-Item C:\* -Force -Recurse"`,
      String.raw`powershell -Command "Remove-Item '$env:SystemDrive\*' -Recurse -Force"`,
      'cmd /c rd /q /s D:\\',
      'format C:',
      'diskpart',
      String.raw`C:\Windows\System32\diskpart.exe`,
      String.raw`dd if=image.bin of=\\.\PhysicalDrive0`,
    ]) {
      expect(catastrophicShellCommandReason(command), command).not.toBe('');
    }

    expect(catastrophicShellCommandReason(
      String.raw`powershell -Command "Remove-Item C:\repo\dist -Force -Recurse"`,
    )).toBe('');
    expect(catastrophicShellCommandReason('Get-ChildItem C:\\')).toBe('');
    expect(catastrophicShellCommandReason('echo "format C:"')).toBe('');
  });

  it('preserves Windows separators when extracting shell write targets', () => {
    expect(shellWritePathCandidates(
      String.raw`powershell -Command "Remove-Item C:\outside\cache -Recurse -Force"`,
    )).toContain(String.raw`C:\outside\cache`);
  });
});
