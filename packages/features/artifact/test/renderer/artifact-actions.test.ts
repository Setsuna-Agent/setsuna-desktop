import { describe, expect, it, vi } from 'vitest';
import type { RuntimeArtifact } from '../../src/contracts/index.js';
import {
  openArtifactInBrowser,
  openArtifactWithDefaultApp,
} from '../../src/renderer/artifact-actions.js';

const artifact: RuntimeArtifact = {
  id: 'artifact_1',
  kind: 'file',
  name: 'report.pdf',
  projectId: 'project_1',
  workspaceRoot: '/workspace',
  path: 'output/report.pdf',
  mimeType: 'application/pdf',
  size: 128,
};

describe('Artifact open actions', () => {
  it('opens the workspace-relative file with the default application', async () => {
    const openWorkspaceFile = vi.fn().mockResolvedValue({ ok: true });

    await expect(openArtifactWithDefaultApp(artifact, openWorkspaceFile)).resolves.toBeNull();
    expect(openWorkspaceFile).toHaveBeenCalledWith('/workspace', 'output/report.pdf');
  });

  it('opens a successful local preview in the in-app browser', async () => {
    const createPreview = vi.fn().mockResolvedValue({
      ok: true,
      url: 'http://127.0.0.1:4321/preview/report.pdf',
    });
    const openBrowser = vi.fn();

    await expect(openArtifactInBrowser(artifact, createPreview, openBrowser)).resolves.toBeNull();
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4321/preview/report.pdf');
  });
});
