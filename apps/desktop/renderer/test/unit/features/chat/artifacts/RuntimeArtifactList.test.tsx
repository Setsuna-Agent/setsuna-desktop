import type { RuntimeArtifact } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimeArtifactList } from '../../../../../src/features/chat/artifacts/RuntimeArtifactList.js';

describe('RuntimeArtifactList', () => {
  it('renders an openable deliverable with its filename and type', () => {
    const artifact: RuntimeArtifact = {
      id: 'artifact_1',
      kind: 'file',
      name: 'deliverable.pdf',
      projectId: 'temporary_workspace',
      workspaceRoot: '/workspace',
      path: 'deliverable.pdf',
      mimeType: 'application/pdf',
      size: 288_000,
    };

    const html = renderToStaticMarkup(<RuntimeArtifactList artifacts={[artifact]} />);

    expect(html).toContain('aria-label="生成的产物"');
    expect(html).toContain('deliverable.pdf');
    expect(html).toContain('文档 · PDF');
    expect(html).toContain('打开方式');
  });
});
