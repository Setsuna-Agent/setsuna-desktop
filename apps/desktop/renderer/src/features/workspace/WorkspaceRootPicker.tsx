import { workspaceProjectRoots, workspaceRootName, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, Folder } from 'lucide-react';
import { ContextMenu } from '../../shared/ui/ContextMenu.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function WorkspaceRootPicker({ project, rootId, disabled, variant = 'toolbar', onChange }: {
  project?: WorkspaceProject;
  rootId?: string;
  disabled?: boolean;
  variant?: 'toolbar' | 'field';
  onChange(rootId: string): void;
}) {
  const { t } = useI18n();
  const roots = workspaceProjectRoots(project);
  if (roots.length < 2) return null;
  const selected = roots.find((root) => root.id === rootId) ?? roots[0];
  return (
    <ContextMenu rootClassName="workspace-root-menu" trigger={['click']} placement="bottomLeft" disabled={disabled} menu={{
      selectedKeys: [selected.id],
      items: roots.map((root) => ({
        key: root.id, icon: <Folder size={14} />,
        label: <span title={root.path}>{workspaceRootName(root)}</span>,
        onClick: () => onChange(root.id),
      })),
    }}>
      <Button variant="ghost" size="small" className={`workspace-root-picker workspace-root-picker--${variant}`} disabled={disabled}
        aria-label={t('sidebar.selectProjectDirectory')} title={selected.path}>
        {variant === 'field' ? <Folder className="workspace-root-picker__icon" size={14} aria-hidden="true" /> : null}
        <span className="workspace-root-picker__label">{workspaceRootName(selected)}</span>
        <ChevronDown className="workspace-root-picker__caret" size={12} aria-hidden="true" />
      </Button>
    </ContextMenu>
  );
}
