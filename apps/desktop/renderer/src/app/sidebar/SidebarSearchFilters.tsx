import { normalizeWorkspaceSearchExtensions, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button, SelectField, TextField } from '@setsuna-desktop/renderer-ui';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ProjectIcon } from '../../shared/ui/ProjectIcon.js';
import type { SidebarSearchCategory } from './sidebarSearchTypes.js';

const categories: SidebarSearchCategory[] = ['all', 'actions', 'threads', 'files', 'text'];

export function SidebarSearchFilters({ category, projectId, projects, extensions, onChangeCategory, onChangeProject, onChangeExtensions }: {
  category: SidebarSearchCategory;
  projectId: string;
  projects: WorkspaceProject[];
  extensions: string;
  onChangeCategory(category: SidebarSearchCategory): void;
  onChangeProject(projectId: string): void;
  onChangeExtensions(extensions: string): void;
}) {
  const { t } = useI18n();
  let invalidExtensions = false;
  try { normalizeWorkspaceSearchExtensions([extensions]); } catch { invalidExtensions = true; }
  return (
    <div className="desktop-agent-search-popover__footer">
      <div className="desktop-agent-search-popover__categories" role="group" aria-label={t('search.categories')}>
        {categories.map((item) => <Button key={item} variant="ghost" type="button" aria-pressed={category === item}
          className={`desktop-agent-search-popover__category${category === item ? ' is-active' : ''}`}
          onClick={() => onChangeCategory(item)}>{t(`search.category.${item}`)}</Button>)}
      </div>
      {category === 'files' || category === 'text' ? (
        <div className="desktop-agent-search-popover__filters">
          <SelectField className="desktop-agent-search-popover__project" value={projectId} disabled={!projects.length}
            aria-label={t('search.project')} title={projects.find((project) => project.id === projectId)?.name}
            renderOptionIcon={(id) => <ProjectIcon icon={projects.find((project) => project.id === id)?.icon} size={14} />}
            onValueChange={onChangeProject}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </SelectField>
          {category === 'text' ? <TextField className="desktop-agent-search-popover__extensions" value={extensions}
            aria-label={t('search.extensions')} placeholder={t('search.extensionsPlaceholder')}
            aria-invalid={invalidExtensions || undefined} title={invalidExtensions ? t('search.invalidExtensions') : undefined}
            onChange={(event) => onChangeExtensions(event.target.value)} /> : null}
        </div>
      ) : null}
    </div>
  );
}
