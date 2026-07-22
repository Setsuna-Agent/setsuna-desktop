import type { RuntimeArtifact } from '@setsuna-desktop/contracts';
import { Button, Dropdown, type MenuProps } from 'antd';
import { ChevronDown, ExternalLink, Globe2 } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { WorkspaceFileIcon } from '../../workspace/WorkspaceFileIcon.js';
import { useMarkdownNavigation } from '../markdown/MarkdownNavigationProvider.js';
import {
  openRuntimeArtifactInBrowser,
  openRuntimeArtifactWithDefaultApp,
  runtimeArtifactSupportsBrowserPreview,
  runtimeArtifactTypeLabel,
} from './runtimeArtifacts.js';

export function RuntimeArtifactCard({ artifact }: { artifact: RuntimeArtifact }) {
  const { t } = useI18n();
  const { onOpenInAppBrowser } = useMarkdownNavigation();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canOpenInBrowser = runtimeArtifactSupportsBrowserPreview(artifact) && Boolean(onOpenInAppBrowser);
  const openMenuItems: MenuProps['items'] = [
    ...(canOpenInBrowser ? [{
      key: 'built-in-browser',
      icon: <Globe2 size={14} />,
      label: t('chat.artifact.openInBrowser'),
    }] : []),
    {
      key: 'system-default',
      icon: <ExternalLink size={14} />,
      label: t('chat.artifact.openDefault'),
    },
  ];

  const handleOpenWithDefaultApp = async () => {
    if (opening) return;
    const openWorkspaceFile = window.setsunaDesktop?.desktop?.openWorkspaceFile;
    if (!openWorkspaceFile) {
      setError(t('chat.artifact.localUnsupported'));
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const openError = await openRuntimeArtifactWithDefaultApp(artifact, openWorkspaceFile, t);
      setError(openError);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : t('chat.artifact.openFailed'));
    } finally {
      setOpening(false);
    }
  };

  const handleOpenInBrowser = async () => {
    if (opening || !onOpenInAppBrowser) return;
    const createPreview = window.setsunaDesktop?.desktop?.createWorkspaceFilePreview;
    if (!createPreview) {
      setError(t('chat.artifact.browserUnsupported'));
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const openError = await openRuntimeArtifactInBrowser(artifact, createPreview, onOpenInAppBrowser);
      setError(openError);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : t('chat.artifact.browserOpenFailed'));
    } finally {
      setOpening(false);
    }
  };

  return (
    <article className="chat-artifact-card">
      <div className="chat-artifact-card__body">
        <span className="chat-artifact-card__icon">
          <WorkspaceFileIcon className="chat-artifact-card__file-icon" path={artifact.path} type="file" />
        </span>
        <span className="chat-artifact-card__metadata">
          <span className="chat-artifact-card__name" title={artifact.path}>{artifact.name}</span>
          <span className="chat-artifact-card__type">{runtimeArtifactTypeLabel(artifact, t)}</span>
        </span>
        <Dropdown
          rootClassName="chat-artifact-open-menu"
          trigger={['click']}
          placement="bottomRight"
          transitionName=""
          menu={{
            items: openMenuItems,
            onClick: ({ key }) => {
              if (key === 'built-in-browser') void handleOpenInBrowser();
              if (key === 'system-default') void handleOpenWithDefaultApp();
            },
          }}
        >
          <Button
            className="chat-artifact-card__open"
            loading={opening}
            aria-label={t('chat.artifact.openMode', { name: artifact.name })}
          >
            <span>{t('chat.artifact.openWith')}</span>
            <ChevronDown size={13} />
          </Button>
        </Dropdown>
      </div>
      {error ? (
        <div className="chat-artifact-card__error" role="alert">
          {t('chat.artifact.error', { error })}
        </div>
      ) : null}
    </article>
  );
}
