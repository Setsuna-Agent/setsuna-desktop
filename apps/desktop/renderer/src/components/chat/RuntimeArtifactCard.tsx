import { useState } from 'react';
import { Button, Dropdown, type MenuProps } from 'antd';
import { ChevronDown, ExternalLink } from 'lucide-react';
import type { RuntimeArtifact } from '@setsuna-desktop/contracts';
import { WorkspaceFileIcon } from '../workspace/WorkspaceFileIcon.js';
import { openRuntimeArtifactWithDefaultApp, runtimeArtifactTypeLabel } from './runtimeArtifacts.js';

const openMenuItems: MenuProps['items'] = [{
  key: 'system-default',
  icon: <ExternalLink size={14} />,
  label: '使用系统默认应用打开',
}];

export function RuntimeArtifactCard({ artifact }: { artifact: RuntimeArtifact }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = async () => {
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
              if (key === 'system-default') void handleOpen();
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
