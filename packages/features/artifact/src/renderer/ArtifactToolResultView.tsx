import type { ToolResultViewProps } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dropdown, type MenuProps } from 'antd';
import { ChevronDown, ExternalLink, Globe2 } from 'lucide-react';
import { useState } from 'react';
import type { ArtifactRendererHost, RuntimeArtifact } from '../contracts/index.js';
import { openArtifactInBrowser, openArtifactWithDefaultApp } from './artifact-actions.js';
import { artifactTypeLabel } from './artifact-model.js';
import { ArtifactFileIcon } from './ArtifactFileIcon.js';
import { useArtifactBrowserNavigation } from './context.js';
import './artifact.css';

export function ArtifactToolResultView({
  host,
  payload,
  translate,
}: ToolResultViewProps<RuntimeArtifact> & Readonly<{ host: ArtifactRendererHost }>) {
  const onOpenBrowser = useArtifactBrowserNavigation();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canOpenInBrowser = Boolean(onOpenBrowser && host.createWorkspaceFilePreview);
  const openMenuItems: MenuProps['items'] = [
    ...(canOpenInBrowser ? [{
      key: 'built-in-browser',
      icon: <Globe2 size={14} />,
      label: translate('feature.artifact.openInBrowser'),
    }] : []),
    {
      key: 'system-default',
      icon: <ExternalLink size={14} />,
      label: translate('feature.artifact.openDefault'),
    },
  ];

  const handleOpenWithDefaultApp = async () => {
    if (opening) return;
    if (!host.openWorkspaceFile) {
      setError(translate('feature.artifact.localUnsupported'));
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const openError = await openArtifactWithDefaultApp(payload, host.openWorkspaceFile);
      setError(openError);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : translate('feature.artifact.openFailed'));
    } finally {
      setOpening(false);
    }
  };

  const handleOpenInBrowser = async () => {
    if (opening || !onOpenBrowser) return;
    if (!host.createWorkspaceFilePreview) {
      setError(translate('feature.artifact.browserUnsupported'));
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const openError = await openArtifactInBrowser(payload, host.createWorkspaceFilePreview, onOpenBrowser);
      setError(openError);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : translate('feature.artifact.browserOpenFailed'));
    } finally {
      setOpening(false);
    }
  };

  return (
    <section className="artifact-result" aria-label={translate('feature.artifact.list')}>
      <article className="artifact-card">
        <div className="artifact-card__body">
          <span className="artifact-card__icon"><ArtifactFileIcon path={payload.path} /></span>
          <span className="artifact-card__metadata">
            <span className="artifact-card__name" title={payload.path}>{payload.name}</span>
            <span className="artifact-card__type">{artifactTypeLabel(payload, translate)}</span>
          </span>
          <Dropdown
            rootClassName="artifact-open-menu"
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: openMenuItems,
              onClick: ({ key }) => {
                if (key === 'built-in-browser') void handleOpenInBrowser();
                if (key === 'system-default') void handleOpenWithDefaultApp();
              },
            }}
          >
            <Button
              className="artifact-card__open"
              loading={opening}
              aria-label={translate('feature.artifact.openMode', { name: payload.name })}
            >
              <span>{translate('feature.artifact.openWith')}</span>
              <ChevronDown size={13} />
            </Button>
          </Dropdown>
        </div>
        {error ? (
          <div className="artifact-card__error" role="alert">
            {translate('feature.artifact.error', { error })}
          </div>
        ) : null}
      </article>
    </section>
  );
}
