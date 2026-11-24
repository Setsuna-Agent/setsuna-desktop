import { ChevronDown } from 'lucide-react';
import { workspaceRootName, type WorkspaceProject, type WorkspaceProjectRoot } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown, SelectField, type MenuItem } from '@setsuna-desktop/renderer-ui';
import { DesignProjectIcon } from './DesignProjectIcon.js';
import { designHomeFilterForProjects, type DesignHomeFilter } from './design-workspace-location.js';

export type DesignProject = Readonly<Pick<WorkspaceProject, 'id' | 'name' | 'icon'>>;
export type DesignCatalogProject = DesignProject & Readonly<{ roots: readonly WorkspaceProjectRoot[] }>;

export function DesignProjectMenu({ projects, projectId, onSelect, translate: t }: Readonly<{
  projects: readonly DesignProject[];
  projectId: string | null;
  onSelect(projectId: string): void;
  translate: RendererTranslate;
}>) {
  if (!projects.length) return null;
  const project = projects.find(({ id }) => id === projectId);
  const label = project?.name ?? t('feature.design.project');
  return <Dropdown placement="bottomLeft" menu={{
    items: projects.map(({ id, name, icon }) => ({ key: id, label: name, icon: <DesignProjectIcon icon={icon} size={15} /> })),
    selectedKeys: project ? [project.id] : undefined,
    onClick: ({ key }) => onSelect(key),
  }}>
    <button type="button" className="design-workspace__project sd-field sd-select-field sd-select-field--with-icon"
      aria-label={t('feature.design.project')} title={label}>
      <span className="sd-select-field__icon"><DesignProjectIcon icon={project?.icon} size={15} /></span>
      <span className="sd-select-field__value">{label}</span>
      <ChevronDown className="sd-select-field__chevron" size={15} aria-hidden="true" />
    </button>
  </Dropdown>;
}

export function DesignScopeFields({ projects, scope, onChange, translate: t }: Readonly<{
  projects: readonly DesignCatalogProject[];
  scope: DesignHomeFilter | null;
  onChange(scope: DesignHomeFilter | null): void;
  translate: RendererTranslate;
}>) {
  if (!projects.length) return null;
  const projectIds = scope?.projectIds ?? (scope?.projectId ? [scope.projectId] : []);
  const selectedIds = new Set(projectIds);
  const project = projects.find(({ id }) => id === projectIds[0]);
  const allProjects = t('feature.design.allProjects');
  const selectionLabel = projects.filter(({ id }) => selectedIds.has(id)).map(({ name }) => name).join(' · ') || allProjects;
  return <div className="design-workspace__scope">
    <Dropdown placement="bottomLeft" menu={{
      selectedKeys: projectIds.length ? undefined : ['all'],
      items: [
        { key: 'all', label: allProjects, icon: <DesignProjectIcon size={15} />, onClick: () => onChange(null) },
        { key: 'separator', type: 'divider' },
        ...projects.map<MenuItem>(({ id, name, icon }) => ({
          key: `project:${id}`, label: name, icon: <DesignProjectIcon icon={icon} size={15} />, checked: selectedIds.has(id),
          onClick: ({ domEvent }) => {
            domEvent.preventDefault();
            onChange(designHomeFilterForProjects(selectedIds.has(id) ? projectIds.filter((item) => item !== id) : [...projectIds, id]));
          },
        })),
      ],
    }}>
      <button type="button" className="design-workspace__project sd-field sd-select-field sd-select-field--with-icon"
        aria-label={t('feature.design.project')} aria-description={selectionLabel} title={selectionLabel}>
        <span className="sd-select-field__icon"><DesignProjectIcon icon={project?.icon} size={15} /></span>
        <span className="sd-select-field__value">{project?.name ?? allProjects}</span>
        {projectIds.length ? <span className="design-workspace-home__project-count" aria-hidden="true">{projectIds.length}</span> : null}
      </button>
    </Dropdown>
    {projectIds.length === 1 && project && project.roots.length > 1 ? <SelectField className="design-workspace__root" aria-label={t('feature.design.directory')}
      value={scope?.rootId ?? ''} menuAlign="start"
      onValueChange={(rootId) => onChange({ projectId: project.id, ...(rootId ? { rootId } : {}) })}>
      <option value="">{t('feature.design.allDirectories')}</option>
      {project.roots.map((item) => <option key={item.id} value={item.id}>{workspaceRootName(item)}</option>)}
    </SelectField> : null}
  </div>;
}
