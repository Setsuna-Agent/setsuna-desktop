import { useCallback, useMemo } from 'react';
import type { DesktopWorkspaceEntriesWatchOptions, WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { DesignDocumentSurface } from '@setsuna-desktop/feature-design/renderer';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { FeatureRecoveryShell } from '../FeatureRecoveryShell.js';
import { useDesignClient } from './DesignClientContext.js';
import { useDesignChat } from './DesignChatHost.js';
import { watchDesignDirectories } from './design-assets.js';

export {
  designHomeFilterForLocation, designHomeFilterForProjects,
  type DesignChatBinding, type DesignHomeFilter, type DesignWorkspaceLocation,
} from '@setsuna-desktop/feature-design/renderer';

export { DesignFeatureServiceBoundary, useDesignClient } from './DesignClientContext.js';

export function WorkspaceDesignFile({ file, workspaceRoot }: Readonly<{ file: WorkspaceFileRead; workspaceRoot?: string }>) {
  const client = useDesignClient();
  const { t } = useI18n();
  const { projectId, rootId, path } = file;
  const renderDesignChat = useDesignChat(projectId);
  const documentRef = useMemo(() => ({ projectId, rootId, path }), [projectId, rootId, path]);
  const watchAssetDirectories = useCallback((directories: readonly string[], changed: () => void, options?: DesktopWorkspaceEntriesWatchOptions) =>
    workspaceRoot ? watchDesignDirectories(workspaceRoot, directories, changed, options) : () => undefined, [workspaceRoot]);
  if (!client) return <FeatureRecoveryShell candidateFeatureIds={['design']} reason="view-missing" />;
  return <DesignDocumentSurface client={client} renderChat={renderDesignChat} documentRef={documentRef}
    fileRevision={file.revision} watchAssetDirectories={watchAssetDirectories} translate={t} />;
}
