import type { RuntimeArtifact } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimeArtifactList } from '../../../../../src/features/chat/artifacts/RuntimeArtifactList.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

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

describe('runtime artifact list component', () => {
  it('renders an openable deliverable card', () => {
    const html = renderToStaticMarkup(<RuntimeArtifactList artifacts={[artifact]} />);

    expect(html).toContain('aria-label="生成的产物"');
    expect(html).toContain('AI大模型发展趋势报告_2023-2025.pdf');
    expect(html).toContain('文档 · PDF');
    expect(html).toContain('打开方式');
    expect(html).toContain('chat-artifact-card__file-icon');
  });

  it('renders artifact metadata and actions in English', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en-US">
        <RuntimeArtifactList artifacts={[artifact]} />
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="Generated artifacts"');
    expect(html).toContain('Document · PDF');
    expect(html).toContain('Open with');
    expect(html).not.toContain('打开方式');
  });
});
