import { useState } from 'react';
import { Button, Dropdown, type MenuProps } from 'antd';
import { ChevronDown, ExternalLink, Globe2 } from 'lucide-react';
import type { RuntimeArtifact } from '@setsuna-desktop/contracts';
import { WorkspaceFileIcon } from '../workspace/WorkspaceFileIcon.js';
import { useMarkdownNavigation } from './markdown/MarkdownNavigationProvider.js';
import {
  openRuntimeArtifactInBrowser,
  openRuntimeArtifactWithDefaultApp,
  runtimeArtifactSupportsBrowserPreview,
  runtimeArtifactTypeLabel,
} from './runtimeArtifacts.js';

export function RuntimeArtifactCard({ artifact }: { artifact: RuntimeArtifact }) {
  const { onOpenInAppBrowser } = useMarkdownNavigation();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canOpenInBrowser = runtimeArtifactSupportsBrowserPreview(artifact) && Boolean(onOpenInAppBrowser);
  const openMenuItems: MenuProps['items'] = [
    ...(canOpenInBrowser ? [{
      key: 'built-in-browser',
      icon: <Globe2 size={14} />,
      label: '在内置浏览器打开',
    }] : []),
    {
      key: 'system-default',
      icon: <ExternalLink size={14} />,
      label: '使用系统默认应用打开',
    },
  ];

  const handleOpenWithDefaultApp = async () => {
    if (opening) return;
    const openWorkspaceFile = window.setsunaDesktop?.desktop?.openWorkspaceFile;
    if (!openWorkspaceFile) {
      setError('当前环境不支持打开本地文件。');
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const openError = await openRuntimeArtifactWithDefaultApp(artifact, openWorkspaceFile);
      setError(openError);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : '无法打开文件。');
    } finally {
      setOpening(false);
    }
  };

  const handleOpenInBrowser = async () => {
    if (opening || !onOpenInAppBrowser) return;
    const createPreview = window.setsunaDesktop?.desktop?.createWorkspaceFilePreview;
    if (!createPreview) {
      setError('当前环境不支持内置浏览器预览。');
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const openError = await openRuntimeArtifactInBrowser(artifact, createPreview, onOpenInAppBrowser);
      setError(openError);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : '无法在内置浏览器中打开文件。');
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
          <span className="chat-artifact-card__type">{runtimeArtifactTypeLabel(artifact)}</span>
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
            aria-label={`${artifact.name} 打开方式`}
          >
            <span>打开方式</span>
            <ChevronDown size={13} />
          </Button>
        </Dropdown>
      </div>
      {error ? <div className="chat-artifact-card__error" role="alert">打开失败：{error}</div> : null}
    </article>
  );
}
