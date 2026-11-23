import { Folder } from 'lucide-react';
import { workspaceRootName, type WorkspaceProjectRoot } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { SelectField } from '@setsuna-desktop/renderer-ui';
import type { DesignWorkspace as DesignScope } from '../../contracts/index.js';

export type DesignCatalogProject = Readonly<{ id: string; name: string; roots: readonly WorkspaceProjectRoot[] }>;

export function DesignScopeFields({ projects, scope, mode, disabled, onChange, translate: t }: Readonly<{
  projects: readonly DesignCatalogProject[];
  scope: DesignScope | null;
  mode: 'association' | 'filter';
  disabled?: boolean;
  onChange(scope: DesignScope | null): void;
  translate: RendererTranslate;
}>) {
  if (!projects.length && !(mode === 'association' && scope?.projectId)) return null;
  const project = projects.find(({ id }) => id === scope?.projectId);
  return <div className="design-workspace__scope">
    <SelectField className="design-workspace__project" aria-label={t('feature.design.project')} title={project?.name}
      disabled={disabled} value={scope?.projectId ?? ''} menuAlign="start" renderOptionIcon={() => <Folder size={15} />}
      onValueChange={(projectId) => onChange(projectId ? { projectId } : null)}>
      <option value="">{t(mode === 'filter' ? 'feature.design.allProjects' : 'feature.design.noProject')}</option>
      {mode === 'association' && scope?.projectId && !project ? <option value={scope.projectId}>{scope.projectId}</option> : null}
      {projects.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </SelectField>
    {mode === 'filter' && project && project.roots.length > 1 ? <SelectField className="design-workspace__root" aria-label={t('feature.design.directory')}
      disabled={disabled} value={scope?.rootId ?? ''} menuAlign="start"
      onValueChange={(rootId) => onChange({ projectId: project.id, ...(rootId ? { rootId } : {}) })}>
      <option value="">{t('feature.design.allDirectories')}</option>
      {project.roots.map((item) => <option key={item.id} value={item.id}>{workspaceRootName(item)}</option>)}
    </SelectField> : null}
  </div>;
}
