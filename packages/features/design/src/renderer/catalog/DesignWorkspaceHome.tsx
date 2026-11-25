import { FolderOpen, Frame, LayoutGrid, List } from 'lucide-react';
import { useMemo, useRef, type ReactNode } from 'react';
import { workspaceFilePathKey, workspaceRootName, type WorkspaceProjectRoot } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, SegmentedControl } from '@setsuna-desktop/renderer-ui';
import type { DesignDocumentRef } from '../../contracts/index.js';
import { DesignThumbnail } from '../canvas/DesignThumbnail.js';
import type { DesignClient } from '../client.js';
import { useDesignViewPreference } from '../context/use-design-view-preference.js';
import { designImportSource, type DesignImportSource } from '../import/design-import.js';
import { DesignCatalogEmpty } from './DesignCatalogEmpty.js';
import { DesignProjectIcon } from './DesignProjectIcon.js';
import type { DesignProject } from './DesignScopeFields.js';
import { useDesignDocumentThumbnails } from './use-design-document-thumbnails.js';
import './design-workspace-home.css';

export type DesignCatalogFile = Readonly<{
  pathKey: string;
  ref: DesignDocumentRef;
  root: WorkspaceProjectRoot;
  source: readonly string[];
  projectId: string | null;
  project?: DesignProject;
  modifiedAt?: string;
  revision?: string;
}>;
export type DesignCatalogSection = 'recent' | 'all';
const recentLimit = 5;
const timeUnits = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]] as const;

export function DesignWorkspaceHome({
  client, scopeControls, createAction, files, fileRevision, showEmptyState, onOpen, onImportDrop, renderFileAction, visible, locale, translate: t,
}: Readonly<{
  client: DesignClient;
  scopeControls: ReactNode;
  createAction: ReactNode;
  visible: boolean;
  locale?: string;
  files: readonly DesignCatalogFile[];
  fileRevision(ref: DesignDocumentRef): string | undefined;
  showEmptyState: boolean;
  onOpen(ref: DesignDocumentRef): void;
  onImportDrop(source: DesignImportSource): void;
  renderFileAction(file: DesignCatalogFile, section: DesignCatalogSection): ReactNode;
  translate: RendererTranslate;
}>) {
  const [view, setView] = useDesignViewPreference('catalog');
  const scroll = useRef<HTMLElement>(null);
  const entries = useMemo(() => files.map((file) => ({ ...file, thumbnailId: JSON.stringify([file.pathKey, file.revision ?? file.modifiedAt]) }))
    .sort((left, right) => (right.modifiedAt ?? '').localeCompare(left.modifiedAt ?? '') || left.ref.path.localeCompare(right.ref.path)), [files]);
  const byThumbnail = useMemo(() => new Map(entries.map(({ thumbnailId, ref }) => [thumbnailId, ref])), [entries]);
  const observeThumbnail = useDesignDocumentThumbnails(scroll, client, byThumbnail, visible, fileRevision);
  const recent = entries.slice(0, recentLimit).filter(({ modifiedAt }) => modifiedAt !== undefined);
  const sections = [
    { id: 'recent', title: t('feature.design.catalog.recent'), entries: recent },
    { id: 'all', title: t('feature.design.catalog.all'), entries },
  ] as const;
  const relativeTime = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale]);
  const dateTime = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
  const now = Date.now();
  const locationLabel = t('feature.design.saveLocation');
  const linkedProjectLabel = t('feature.design.linkProject');
  const localLabel = t('feature.design.localDesigns');
  function editedTime(modifiedAt: string) {
    const seconds = Math.max(0, (now - Date.parse(modifiedAt)) / 1000);
    const unit = timeUnits.find(([, size]) => seconds >= size);
    return unit ? relativeTime.format(-Math.floor(seconds / unit[1]), unit[0]) : t('feature.design.catalog.justNow');
  }

  return <main ref={scroll} className="design-workspace-home" data-view={view}
    onDragOver={(event) => {
      // The file names in a native drag become readable only on drop.
      if (!visible || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }}
    onDrop={(event) => {
      if (!visible || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.stopPropagation();
      for (const file of event.dataTransfer.files) {
        const source = designImportSource(file);
        if (!source) continue;
        onImportDrop(source);
        break;
      }
    }}>
    <div className="design-workspace-home__content" data-empty={showEmptyState ? '' : undefined}>
      <header className="design-workspace-home__header">
        <h1 className="design-workspace-home__title">{t('feature.design.workspace')}</h1>
        <div className="design-workspace-home__actions">
          <SegmentedControl<typeof view> label={t('feature.design.catalog.view')} value={view} onChange={setView}
            className="design-workspace-home__view" iconOnly options={[
              { value: 'grid', label: t('feature.design.catalog.grid'), icon: <LayoutGrid size={16} /> },
              { value: 'list', label: t('feature.design.catalog.list'), icon: <List size={16} /> },
            ]} />
          {scopeControls}
          {createAction}
        </div>
      </header>
      {showEmptyState ? <DesignCatalogEmpty title={t('feature.design.noProjectDrafts')} /> : null}
      {sections.map(({ id, title, entries }) => entries.length > 0 ? (
        <section key={id} aria-label={title}>
          <h2 className="design-workspace-home__heading">{title}<span>{entries.length}</span></h2>
          <ul className="design-workspace-home__files">
            {entries.map((file) => {
              const { pathKey, ref, root, source, project, modifiedAt, thumbnailId } = file;
              const { name, folder } = designFileParts(ref.path);
              const label = [...source, ref.path].join(' / ');
              const rootName = ref.storageId === 'local' ? localLabel : workspaceRootName(root);
              const location = folder ? `${rootName} / ${folder}` : rootName;
              const locationPath = folder ? workspaceFilePathKey(root.path, folder) : root.path;
              const locationTitle = `${locationLabel} · ${locationPath}`;
              const projectTitle = project ? `${linkedProjectLabel} · ${project.name}` : undefined;
              const description = projectTitle ? `${locationTitle} · ${projectTitle}` : locationTitle;
              const showSeparateLocation = location !== project?.name;
              const time = modifiedAt ? <time dateTime={modifiedAt} title={dateTime.format(new Date(modifiedAt))}>{editedTime(modifiedAt)}</time> : null;
              return <li key={pathKey}>
                <Button variant="ghost" className="design-workspace-home__file" title={label} aria-label={label}
                  aria-description={description} onClick={() => onOpen(ref)}>
                  <DesignThumbnail id={thumbnailId} observe={observeThumbnail} waitForDecode fallback={<Frame size={20} strokeWidth={1.55} />} />
                  <span className="design-workspace-home__file-label">
                    <strong>{name}</strong>
                    <span className="design-workspace-home__file-meta">
                      {showSeparateLocation ? <span className="design-workspace-home__file-detail" title={locationTitle}>
                        <FolderOpen size={12} aria-hidden="true" /><span>{location}</span>
                      </span> : null}
                      {project ? <span className="design-workspace-home__file-detail" title={showSeparateLocation ? projectTitle : description}>
                        <DesignProjectIcon icon={project.icon} size={12} /><span>{project.name}</span>
                      </span> : null}
                      {view === 'grid' ? time : null}
                    </span>
                  </span>
                  {view === 'list' ? time : null}
                </Button>
                <div className="design-workspace-home__file-menu">{renderFileAction(file, id)}</div>
              </li>;
            })}
          </ul>
        </section>
      ) : null)}
    </div>
  </main>;
}

export function designFileParts(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf('/');
  const fileName = path.slice(slash + 1);
  return { name: fileName.replace(/\.design\.json$/iu, '') || fileName, folder: slash === -1 ? '' : path.slice(0, slash) };
}
