import { ArrowLeft, Folder, Frame, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { workspaceFileKey, workspaceProjectRoots, workspaceRootName, type DesktopWorkspaceEntriesWatchOptions, type WorkspaceProject } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, SelectField, useToast } from '@setsuna-desktop/renderer-ui';
import { designDocumentFileExtension } from '../contracts/index.js';
import { DesignDocumentSurface } from './DesignDocumentSurface.js';
import { DesignWorkspaceHome, designFileParts } from './DesignWorkspaceHome.js';
import type { DesignClient } from './client.js';
import './design.css';
import './design-workspace.css';

export type DesignWorkspaceLocation = Readonly<{ projectId: string; rootId?: string; path?: string }>;

export type DesignWorkspaceProps = Readonly<{
  client: DesignClient;
  projects: readonly WorkspaceProject[];
  preferredProjectId?: string | null;
  location: DesignWorkspaceLocation | null;
  onLocationChange(location: DesignWorkspaceLocation): void;
  watchDirectories(root: string, paths: readonly string[], changed: () => void, options?: DesktopWorkspaceEntriesWatchOptions): () => void;
  onAddProject(): void;
  renderCreateDialog(onClose: () => void, onSubmit: (name: string) => Promise<void>): ReactNode;
  translate: RendererTranslate;
}>;

type DocumentList = Readonly<{ key: string; paths: readonly string[] }>;
const emptyPaths: readonly string[] = [];

export default function DesignWorkspace(props: DesignWorkspaceProps) {
  const { client, location, onLocationChange, projects, preferredProjectId, watchDirectories, translate: t } = props;
  const projectsWithRoots = projects.filter((project) => workspaceProjectRoots(project).length > 0);
  const project = projectsWithRoots.find(({ id }) => id === location?.projectId)
    ?? projectsWithRoots.find(({ id }) => id === preferredProjectId)
    ?? projectsWithRoots[0];
  const roots = workspaceProjectRoots(project);
  const root = roots.find(({ id }) => id === location?.rootId && project?.id === location?.projectId) ?? roots[0];
  const projectId = project?.id;
  const rootId = root?.id;
  const path = location?.projectId === projectId && (!location?.rootId || location.rootId === rootId) ? location?.path : undefined;
  const workspaceRoot = root?.path;
  const editing = Boolean(path);
  const scope = JSON.stringify([projectId, rootId]);
  const latestScope = useRef(scope);
  latestScope.current = scope;

  const [documents, setDocuments] = useState<DocumentList>();
  const [listRevision, setListRevision] = useState(0);
  const [createScope, setCreateScope] = useState<string>();
  const paths = documents?.key === scope ? documents.paths : emptyPaths;
  const mounted = useRef(false);
  const toast = useToast();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!projectId || !rootId) return;
    const controller = new AbortController();
    void client.list({ projectId, rootId }, controller.signal).then((paths) => {
      if (controller.signal.aborted) return;
      setDocuments((current) => current?.key === scope && current.paths.length === paths.length
        && current.paths.every((item, index) => item === paths[index]) ? current : { key: scope, paths });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) toast.error(t('feature.design.loadDocumentsFailed', { error: errorMessage(error) }));
    });
    return () => controller.abort();
  }, [client, editing, listRevision, projectId, rootId, scope, t, toast]);

  useEffect(() => {
    if (editing || !workspaceRoot) return;
    const changed = () => setListRevision((revision) => revision + 1);
    const unwatch = watchDirectories(workspaceRoot, ['.'], changed, { recursive: true, contentExtensions: [designDocumentFileExtension] });
    window.addEventListener('focus', changed);
    return () => {
      window.removeEventListener('focus', changed);
      unwatch();
    };
  }, [editing, watchDirectories, workspaceRoot]);

  const documentRef = useMemo(() => projectId && rootId && path ? { projectId, rootId, path } : null,
    [path, projectId, rootId]);
  const watchAssetDirectories = useCallback((directories: readonly string[], changed: () => void, options?: DesktopWorkspaceEntriesWatchOptions) =>
    workspaceRoot ? watchDirectories(workspaceRoot, directories, changed, options) : () => undefined, [watchDirectories, workspaceRoot]);
  const watchChanges = useCallback((changed: () => void) => {
    if (!path) return () => undefined;
    const unwatch = watchAssetDirectories([designFileParts(path).folder || '.'], changed);
    window.addEventListener('focus', changed);
    return () => {
      window.removeEventListener('focus', changed);
      unwatch();
    };
  }, [path, watchAssetDirectories]);

  async function create(name: string) {
    if (!projectId || !rootId) return;
    const entry = await client.create({ projectId, rootId, parentPath: '.', name });
    if (!mounted.current || latestScope.current !== scope) return;
    setDocuments((current) => ({
      key: scope, paths: orderPaths([...(current?.key === scope ? current.paths : []), entry.path]),
    }));
    setListRevision((revision) => revision + 1);
    onLocationChange({ projectId, rootId, path: entry.path });
  }

  const visiblePaths = path && !paths.includes(path) ? orderPaths([...paths, path]) : paths;
  const startCreate = () => setCreateScope(scope);
  function openFile(item: string) {
    if (projectId && rootId) onLocationChange({ projectId, rootId, path: item });
  }
  const scopeControls = project ? (
    <div className="design-workspace__scope">
      <SelectField className="design-workspace__project" aria-label={t('feature.design.project')} title={project.name}
        value={project.id} menuAlign="start" renderOptionIcon={() => <Folder size={15} />}
        onValueChange={(id) => onLocationChange({ projectId: id })}>
        {projectsWithRoots.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </SelectField>
      {roots.length > 1 && root ? (
        <SelectField className="design-workspace__root" aria-label={t('feature.design.directory')} title={workspaceRootName(root)}
          value={root.id} menuAlign="start" onValueChange={(id) => onLocationChange({ projectId: project.id, rootId: id })}>
          {roots.map((item) => <option key={item.id} value={item.id}>{workspaceRootName(item)}</option>)}
        </SelectField>
      ) : null}
    </div>
  ) : null;

  return <div className="design-workspace">
    {documentRef ? (
      <div className="design-workspace__editing">
        <nav className="design-workspace__bar" aria-label={t('feature.design.documents')}>
          <IconButton size="small" label={t('feature.design.backToDocuments')}
            onClick={() => onLocationChange({ projectId: documentRef.projectId, rootId: documentRef.rootId })}>
            <ArrowLeft size={17} />
          </IconButton>
          {scopeControls}
          <span className="design-editor__toolbar-divider" aria-hidden="true" />
          <SelectField className="design-workspace__current-file" aria-label={t('feature.design.documents')}
            title={documentRef.path} value={documentRef.path} valueContent={designFileParts(documentRef.path).name}
            menuAlign="start" renderOptionIcon={() => <Frame size={15} />} onValueChange={openFile}>
            {visiblePaths.map((item) => {
              const { name, folder } = designFileParts(item);
              return <option key={item} value={item}>{folder ? `${folder}/${name}` : name}</option>;
            })}
          </SelectField>
          <IconButton size="small" className="design-workspace__bar-create" label={t('feature.design.newDocument')} onClick={startCreate}>
            <Plus size={17} />
          </IconButton>
        </nav>
        <div className="design-workspace__editor">
          <DesignDocumentSurface key={workspaceFileKey(documentRef)} client={client}
            documentRef={documentRef} watchChanges={watchChanges} watchAssetDirectories={watchAssetDirectories} onOpenLibrary={openFile} translate={t} />
        </div>
      </div>
    ) : <DesignWorkspaceHome scopeControls={scopeControls}
      createLabel={t(rootId ? 'feature.design.newDocument' : 'feature.design.addProject')}
      paths={paths} onCreate={rootId ? startCreate : props.onAddProject} onOpen={openFile} translate={t} />}
    {createScope === scope ? props.renderCreateDialog(() => setCreateScope(undefined), create) : null}
  </div>;
}

function orderPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
