import { describe, expect, it } from 'vitest';
import {
  assessFileMutationPolicy,
  fileMutationPathsForPolicy,
  protectedWorkspaceMetadataPathForPath,
  protectedWorkspaceMetadataPathForTool,
} from './file-system-policy.js';

describe('file system policy', () => {
  it('rejects writes under read-only permission profile', () => {
    expect(assessFileMutationPolicy({
      args: { file_path: 'src/generated.ts' },
      permissionProfile: 'read-only',
      toolName: 'write_file',
    })).toMatchObject({
      action: 'reject',
      reason: expect.stringContaining('read-only'),
    });
  });

  it('protects workspace metadata unless full access is selected', () => {
    expect(protectedWorkspaceMetadataPathForTool('write_file', { file_path: '.git/config' }, 'workspace-write')).toBe('.git/config');
    expect(protectedWorkspaceMetadataPathForTool('write_file', { file_path: '.git/config' }, 'danger-full-access')).toBe('');
    expect(protectedWorkspaceMetadataPathForPath('/tmp/work/.codex/config.json', 'workspace-write')).toBe('/tmp/work/.codex/config.json');
  });

  it('asks for strict file writes with per-path approval keys', () => {
    const assessment = assessFileMutationPolicy({
      approvalPolicy: 'strict',
      args: { file_path: 'src/generated.ts' },
      permissionProfile: 'workspace-write',
      projectId: 'project_1',
      toolName: 'write_file',
    });

    expect(assessment).toMatchObject({
      action: 'ask',
      approvalKeys: [
        JSON.stringify({
          type: 'file-write',
          projectId: 'project_1',
          profile: 'workspace-write',
          path: 'src/generated.ts',
        }),
      ],
    });
  });

  it('extracts source and destination paths from apply_patch move hunks', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move to: src/new.ts',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n');

    expect(fileMutationPathsForPolicy('apply_patch', { patch })).toEqual(['src/old.ts', 'src/new.ts']);
  });

  it('resolves apply_patch paths through workdir for policy checks', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: config',
      '+unsafe',
      '*** End Patch',
    ].join('\n');

    expect(fileMutationPathsForPolicy('apply_patch', { patch, workdir: '.git' })).toEqual(['.git/config']);
    expect(protectedWorkspaceMetadataPathForTool('apply_patch', { patch, workdir: '.git' }, 'workspace-write')).toBe('.git/config');
  });
});
