import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuntimeArtifact } from '../../src/contracts/index.js';
import { ArtifactToolResultView } from '../../src/renderer/ArtifactToolResultView.js';

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

describe('ArtifactToolResultView', () => {
  it('uses the bundled file-type icon for the published file', () => {
    const html = renderToStaticMarkup(
      <ArtifactToolResultView
        host={{ createWorkspaceFilePreview: null, openWorkspaceFile: null }}
        payload={artifact}
        threadId="thread_1"
        translate={(key) => key}
      />,
    );

    expect(html).toContain('data-file-icon-theme="seti"');
    expect(html).toContain('data-file-icon-color=');
    expect(html).toContain('report.pdf');
  });
});
