import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuntimeArtifact } from '@setsuna-desktop/contracts';
import { RuntimeArtifactList } from './RuntimeArtifactList.js';

describe('runtime artifact list component', () => {
  it('renders an openable deliverable card', () => {
    const artifact: RuntimeArtifact = {
      id: 'artifact_1',
      kind: 'file',
      name: 'AI大模型发展趋势报告_2023-2025.pdf',
      projectId: 'temporary_workspace',
      workspaceRoot: '/workspace',
      path: 'AI大模型发展趋势报告_2023-2025.pdf',
      mimeType: 'application/pdf',
      size: 288_000,
    };

    const html = renderToStaticMarkup(<RuntimeArtifactList artifacts={[artifact]} />);

    expect(html).toContain('aria-label="生成的产物"');
    expect(html).toContain('AI大模型发展趋势报告_2023-2025.pdf');
    expect(html).toContain('文档 · PDF');
    expect(html).toContain('打开方式');
    expect(html).toContain('chat-artifact-card__file-icon');
  });
});
