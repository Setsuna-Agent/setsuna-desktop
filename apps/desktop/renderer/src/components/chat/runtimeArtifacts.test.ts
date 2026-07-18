import { describe, expect, it, vi } from 'vitest';
import { PUBLISH_ARTIFACT_TOOL_NAME, type RuntimeArtifact, type RuntimeToolRun } from '@setsuna-desktop/contracts';
import {
  openRuntimeArtifactWithDefaultApp,
  runtimeArtifactsFromToolRuns,
  runtimeArtifactTypeLabel,
} from './runtimeArtifacts.js';

const pdfArtifact: RuntimeArtifact = {
  id: 'artifact_1',
  kind: 'file',
  name: 'AI 趋势报告.pdf',
  projectId: 'temporary_workspace',
  workspaceRoot: '/workspace',
  path: 'output/AI 趋势报告.pdf',
  mimeType: 'application/pdf',
  size: 1024,
};

describe('runtime artifacts', () => {
  it('extracts successful published artifacts and keeps the latest metadata per file', () => {
    const imageArtifact: RuntimeArtifact = {
      ...pdfArtifact,
      id: 'artifact_image',
      name: 'preview.png',
      path: 'generated-images/preview.png',
      mimeType: 'image/png',
      size: 2048,
    };
    const runs: RuntimeToolRun[] = [
      artifactRun({ ...pdfArtifact, id: 'artifact_old', size: 512 }),
      { ...artifactRun(pdfArtifact), id: 'call_latest' },
      artifactRun(imageArtifact),
      { ...artifactRun({ ...pdfArtifact, path: '../secret.pdf' }), id: 'call_invalid' },
      { ...artifactRun({ ...pdfArtifact, path: 'failed.pdf' }), id: 'call_failed', status: 'error' },
      { id: 'call_shell', name: 'run_shell_command', status: 'success', data: { artifact: pdfArtifact } },
    ];

    expect(runtimeArtifactsFromToolRuns(runs)).toEqual([pdfArtifact, imageArtifact]);
  });

  it('creates concise localized type labels', () => {
    expect(runtimeArtifactTypeLabel(pdfArtifact)).toBe('文档 · PDF');
    expect(runtimeArtifactTypeLabel({ ...pdfArtifact, name: '预算.xlsx' })).toBe('表格 · XLSX');
    expect(runtimeArtifactTypeLabel({ ...pdfArtifact, name: 'preview.png' })).toBe('图片 · PNG');
    expect(runtimeArtifactTypeLabel({ ...pdfArtifact, name: 'bundle.unknown' })).toBe('文件 · UNKNOWN');
  });

  it('opens the workspace-relative artifact with the desktop bridge', async () => {
    const openWorkspaceFile = vi.fn().mockResolvedValue({ ok: true });

    await expect(openRuntimeArtifactWithDefaultApp(pdfArtifact, openWorkspaceFile)).resolves.toBeNull();
    expect(openWorkspaceFile).toHaveBeenCalledWith('/workspace', 'output/AI 趋势报告.pdf');

    openWorkspaceFile.mockResolvedValueOnce({ ok: false, error: 'missing' });
    await expect(openRuntimeArtifactWithDefaultApp(pdfArtifact, openWorkspaceFile)).resolves.toBe('missing');
  });
});

function artifactRun(artifact: RuntimeArtifact): RuntimeToolRun {
  return {
    id: `call_${artifact.id}`,
    name: PUBLISH_ARTIFACT_TOOL_NAME,
    status: 'success',
    data: { artifact },
  };
}
