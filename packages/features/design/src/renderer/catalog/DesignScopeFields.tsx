import { Folder } from 'lucide-react';
import { workspaceRootName, type WorkspaceProjectRoot } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { SelectField } from '@setsuna-desktop/renderer-ui';
import type { DesignWorkspace as DesignScope } from '../../contracts/index.js';

export type DesignCatalogProject = Readonly<{ id: string; name: string; roots: readonly WorkspaceProjectRoot[] }>;

export function designDestination(projects: readonly DesignCatalogProject[], scope: DesignScope | null | undefined): DesignScope | null {
  const project = projects.find(({ id }) => id === scope?.projectId);
  if (!project) return null;
  const root = scope?.rootId ? project.roots.find(({ id }) => id === scope.rootId) : project.roots.length === 1 ? project.roots[0] : undefined;
  return root ? { projectId: project.id, rootId: root.id } : null;
}

export function DesignScopeFields({ projects, scope, mode, disabled, onChange, translate: t }: Readonly<{
  projects: readonly DesignCatalogProject[];
  scope: DesignScope | null;
  mode: 'editor' | 'filter' | 'choose';
  disabled?: boolean;
  onChange(scope: DesignScope | null): void;
  translate: RendererTranslate;
}>) {
  if (!projects.length) return null;
  const project = projects.find(({ id }) => id === scope?.projectId);
  return <div className="design-workspace__scope">
    <SelectField className="design-workspace__project" aria-label={t('feature.design.project')} title={project?.name}
      disabled={disabled} value={project?.id ?? ''} menuAlign="start" renderOptionIcon={() => <Folder size={15} />}
      onValueChange={(projectId) => onChange(projectId ? { projectId } : null)}>
      {mode === 'editor' ? null : <option value="">{t(mode === 'filter' ? 'feature.design.allProjects' : 'feature.design.chooseProject')}</option>}
      {projects.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </SelectField>
    {project && project.roots.length > 1 ? <SelectField className="design-workspace__root" aria-label={t('feature.design.directory')}
      disabled={disabled} value={scope?.rootId ?? ''} menuAlign="start"
      onValueChange={(rootId) => onChange({ projectId: project.id, ...(rootId ? { rootId } : {}) })}>
      {mode === 'editor' ? null : <option value="">{t(mode === 'filter' ? 'feature.design.allDirectories' : 'feature.design.chooseDirectory')}</option>}
      {project.roots.map((item) => <option key={item.id} value={item.id}>{workspaceRootName(item)}</option>)}
    </SelectField> : null}
  </div>;
}
