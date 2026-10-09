import { workspaceProjectRoots, workspaceRootName, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, Folder } from 'lucide-react';
import { ContextMenu } from '../../shared/ui/ContextMenu.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function WorkspaceRootPicker({ project, rootId, disabled, onChange }: {
  project?: WorkspaceProject;
  rootId?: string;
  disabled?: boolean;
  onChange(rootId: string): void;
}) {
  const { t } = useI18n();
  const roots = workspaceProjectRoots(project);
  if (roots.length < 2) return null;
  const selected = roots.find((root) => root.id === rootId) ?? roots[0];
  return (
    <ContextMenu trigger={['click']} placement="bottomLeft" disabled={disabled} menu={{
      selectedKeys: [selected.id],
      items: roots.map((root) => ({
        key: root.id, icon: <Folder size={14} />,
        label: <span title={root.path}>{workspaceRootName(root)}</span>,
        onClick: () => onChange(root.id),
      })),
    }}>
      <Button variant="ghost" className="workspace-root-picker" disabled={disabled}
        aria-label={t('sidebar.selectProjectDirectory')} title={selected.path}>
        <Folder size={14} aria-hidden="true" />
        <span>{workspaceRootName(selected)}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
    </ContextMenu>
  );
}
