import { ArrowLeft, Frame, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { workspaceFileKey, workspaceFilePathKey, workspaceProjectRoots, workspaceRootName, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton, SelectField, useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignDocumentRef, DesignWorkspace as DesignScope } from '../contracts/index.js';
import { DesignDocumentSurface } from './DesignDocumentSurface.js';
import { DesignCreateDocument } from './catalog/DesignCreateDocument.js';
import { DesignDocumentMenu } from './catalog/DesignDocumentMenu.js';
import { DesignMoveForm } from './catalog/DesignMoveForm.js';
import { DesignScopeFields } from './catalog/DesignScopeFields.js';
import { DesignWorkspaceHome, designFileParts, type DesignCatalogFile } from './catalog/DesignWorkspaceHome.js';
import type { DesignClient } from './client.js';
import type { WatchDesignDirectories } from './design-images.js';
import { designListingKey, useDesignDocumentLists, type WatchDesignRootDirectories } from './catalog/use-design-document-lists.js';
import { withPausedDesignEdits } from './document/pending-design-edits.js';
import './design.css';
import './design-workspace.css';

export type DesignWorkspaceLocation = DesignScope & Readonly<{ path?: string; homeFilter?: DesignScope }>;

export type DesignWorkspaceProps = Readonly<{
  client: DesignClient;
  projects: readonly WorkspaceProject[];
  location: DesignWorkspaceLocation | null;
  onLocationChange(location: DesignWorkspaceLocation | null): void;
  watchDirectories: WatchDesignRootDirectories;
  onAddProject(): void;
  translate: RendererTranslate;
}>;

type DocumentActionRequest = Readonly<{
  kind: 'move' | 'delete'; location: DesignWorkspaceLocation | null; menuKey: string; source: DesignDocumentRef;
}>;
const emptyPaths: readonly string[] = [];

export default function DesignWorkspace(props: DesignWorkspaceProps) {
  const { client, location, onLocationChange, projects, watchDirectories, translate: t } = props;
  const catalog = useMemo(() => projects.flatMap((project) => {
    const roots = workspaceProjectRoots(project);
    return roots.length ? [{ id: project.id, name: project.name, roots }] : [];
  }), [projects]);
  const requestedFilter = location?.path ? location.homeFilter : location;
  const filteredProject = catalog.find(({ id }) => id === requestedFilter?.projectId);
  const filterRootId = filteredProject?.roots.find(({ id }) => id === requestedFilter?.rootId)?.id;
  const homeFilter = useMemo<DesignScope | null>(() => filteredProject
    ? { projectId: filteredProject.id, ...(filterRootId ? { rootId: filterRootId } : {}) } : null, [filteredProject, filterRootId]);
  const project = location?.path ? catalog.find(({ id }) => id === location.projectId) : undefined;
  const root = location?.rootId ? project?.roots.find(({ id }) => id === location.rootId) : project?.roots[0];
  const path = location?.path;
  const projectId = project?.id;
  const rootId = root?.id;
  const documentRef = useMemo(() => projectId && rootId && path ? { projectId, rootId, path } : null,
    [path, projectId, rootId]);
  const workspaceRoot = root?.path;
  const listProjectId = documentRef?.projectId ?? homeFilter?.projectId;
  const listRootId = documentRef?.rootId ?? homeFilter?.rootId;
  const scopes = useMemo(() => catalog.flatMap((item) => {
    if (listProjectId && listProjectId !== item.id) return [];
    return item.roots.filter(({ id }) => !listRootId || listRootId === id).map((root) => ({
      projectId: item.id, root, source: item.roots.length > 1 ? [item.name, workspaceRootName(root)] : [item.name],
    }));
  }), [catalog, listProjectId, listRootId]);
  const latestLocation = useRef(location);
  latestLocation.current = location;
  const resolvingSource = useRef<AbortController>();
  const [actionRequest, setActionRequest] = useState<DocumentActionRequest>();
  const [actionPending, setActionPending] = useState(false);
  const mutatingFiles = useRef<ReadonlySet<string>>();
  const [layersToggleTarget, setLayersToggleTarget] = useState<HTMLSpanElement | null>(null);
  const mounted = useRef(false);
  const toast = useToast();
  const reportListFailure = useCallback((error: unknown) => {
    toast.error(t('feature.design.loadDocumentsFailed', { error: error instanceof Error ? error.message : String(error) }));
  }, [t, toast]);
  const { lists, refresh: refreshLists } = useDesignDocumentLists(client, scopes, documentRef ? undefined : watchDirectories, reportListFailure);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; resolvingSource.current?.abort(); };
  }, []);
  const watchAssetDirectories = useCallback<WatchDesignDirectories>((directories, changed, options) =>
    workspaceRoot ? watchDirectories(workspaceRoot, directories, changed, options) : () => undefined, [watchDirectories, workspaceRoot]);
  const watchChanges = useCallback((changed: () => void) => {
    if (!documentRef) return () => undefined;
    const key = workspaceFileKey(documentRef);
    const refresh = () => { if (!mutatingFiles.current?.has(key)) changed(); };
    const unwatch = watchAssetDirectories([designFileParts(documentRef.path).folder || '.'], refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      unwatch();
    };
  }, [documentRef, watchAssetDirectories]);

  const backToDocuments = useCallback(() => onLocationChange(homeFilter), [homeFilter, onLocationChange]);
  function openDocument(ref: DesignDocumentRef) {
    onLocationChange({ ...ref, ...(homeFilter ? { homeFilter } : {}) });
  }

  function resolveDocumentSource(ref: DesignDocumentRef, resolved: (source: DesignDocumentRef) => void, failed: (error: unknown) => void) {
    resolvingSource.current?.abort();
    const controller = new AbortController();
    resolvingSource.current = controller;
    const isCurrent = () => !controller.signal.aborted && mounted.current && latestLocation.current === location;
    void client.resolveResourceRoot(ref, controller.signal).then((source) => {
      if (isCurrent()) resolved(source);
    }).catch((error: unknown) => {
      if (isCurrent() && !isFeatureOperationCancelled(error)) failed(error);
    }).finally(() => { if (resolvingSource.current === controller) resolvingSource.current = undefined; });
  }

  function openListedDocument(ref: DesignDocumentRef) {
    resolveDocumentSource(ref, openDocument, (error) => {
      toast.error(t('feature.design.loadFailed', { error: error instanceof Error ? error.message : String(error) }));
    });
  }

  function createAction(trigger: ReactElement) {
    const initialScope = documentRef ?? homeFilter ?? (catalog.length === 1 ? { projectId: catalog[0].id } : null);
    return <DesignCreateDocument key={documentRef ? workspaceFileKey(documentRef) : JSON.stringify(homeFilter)}
      projects={catalog} initialScope={initialScope} fixedScope={Boolean(documentRef)} onCreate={create} translate={t}>{trigger}</DesignCreateDocument>;
  }

  async function create(scope: DesignScope, name: string) {
    const entry = await client.create({ ...scope, parentPath: '.', name });
    if (mounted.current && latestLocation.current === location) openDocument({ ...scope, path: entry.path });
  }

  const closeAction = () => setActionRequest(undefined);
  function reportActionFailure(kind: DocumentActionRequest['kind'], error: unknown) {
    toast.error(t(kind === 'move' ? 'feature.design.moveDocumentFailed' : 'feature.design.deleteDocumentFailed', {
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  function documentMenu(ref: DesignDocumentRef) {
    const name = designFileParts(ref.path).name;
    const menuKey = workspaceFileKey(ref);
    const action = actionRequest?.location === location && actionRequest.menuKey === menuKey ? actionRequest : undefined;
    const deleteTitle = t('feature.design.deleteDocumentTitle', { path: ref.path });
    const form = action?.kind === 'move' ? {
      label: t('feature.design.moveDocumentTitle', { name }),
      content: <DesignMoveForm projects={catalog.filter(({ id }) => id !== action.source.projectId)} pending={actionPending}
        onMove={(destination) => { void runDocumentAction((ref) => client.move({ ref, destination }), openDocument); }}
        onClose={closeAction} translate={t} />,
    } : action?.kind === 'delete' ? {
      label: deleteTitle,
      content: <div className="design-popover-form">
        <strong>{deleteTitle}</strong>
        <span className="design-popover-form__description">{t('feature.design.deleteDocumentPermanent')}</span>
        <div className="design-popover-form__actions">
          <Button size="small" disabled={actionPending} onClick={closeAction}>{t('feature.design.cancel')}</Button>
          <Button size="small" variant="danger" loading={actionPending}
            onClick={() => { void runDocumentAction(client.delete, () => { if (documentRef) backToDocuments(); }); }}>
            {t('feature.design.deleteDocument')}
          </Button>
        </div>
      </div>,
    } : undefined;
    return <DesignDocumentMenu name={name} translate={t} disabled={actionPending} form={form} onCloseForm={closeAction}
      onMove={catalog.length > 1 ? () => {
        closeAction();
        resolveDocumentSource(ref, (source) => setActionRequest({ kind: 'move', location, menuKey, source }),
          (error) => reportActionFailure('move', error));
      } : undefined}
      onDelete={() => {
        resolvingSource.current?.abort();
        setActionRequest({ kind: 'delete', location, menuKey, source: ref });
      }} />;
  }

  async function runDocumentAction<T>(operation: (ref: DesignDocumentRef) => Promise<T>, complete: (result: T) => void) {
    if (!actionRequest || mutatingFiles.current) return;
    const { source, menuKey, kind, location: startedAt } = actionRequest;
    const isCurrent = () => mounted.current && latestLocation.current === startedAt;
    const keys = new Set([menuKey, workspaceFileKey(source)]);
    mutatingFiles.current = keys;
    setActionPending(true);
    try {
      await withPausedDesignEdits(client, keys, async () => {
        if (!isCurrent()) return;
        const result = await operation(source);
        if (!isCurrent()) return;
        setActionRequest(undefined);
        refreshLists();
        complete(result);
      });
    } catch (error: unknown) {
      if (isCurrent() && !isFeatureOperationCancelled(error)) reportActionFailure(kind, error);
    } finally {
      mutatingFiles.current = undefined;
      if (mounted.current) setActionPending(false);
    }
  }

  const paths = projectId && root ? lists.get(designListingKey({ projectId, root })) ?? emptyPaths : emptyPaths;
  const visiblePaths = path && !paths.includes(path) ? orderPaths([...paths, path]) : paths;
  function openFile(item: string) {
    if (documentRef && item !== documentRef.path) openListedDocument({ ...documentRef, path: item });
  }
  const files = useMemo(() => {
    if (documentRef) return [];
    const byPath = new Map<string, DesignCatalogFile>();
    for (const scope of scopes) {
      for (const path of lists.get(designListingKey(scope)) ?? emptyPaths) {
        const pathKey = workspaceFilePathKey(scope.root.path, path);
        const listed = byPath.get(pathKey);
        // For the same absolute file, the shortest relative route starts at the deepest bound root.
        if (listed && listed.ref.path.split('/').length <= path.split('/').length) continue;
        byPath.set(pathKey, { pathKey, ref: { projectId: scope.projectId, rootId: scope.root.id, path }, source: scope.source });
      }
    }
    return [...byPath.values()];
  }, [documentRef, lists, scopes]);
  const scopeControls = <DesignScopeFields projects={catalog} scope={documentRef ?? homeFilter} mode={documentRef ? 'editor' : 'filter'}
    onChange={onLocationChange} translate={t} />;
  return <div className="design-workspace">
    {documentRef ? (
      <div className="design-workspace__editing">
        <nav className="design-workspace__bar" aria-label={t('feature.design.documents')}>
          <span className="design-workspace__layers-slot" ref={setLayersToggleTarget} />
          <IconButton size="small" label={t('feature.design.backToDocuments')} onClick={backToDocuments}>
            <ArrowLeft size={17} />
          </IconButton>
          {scopeControls}
          <span className="design-tools__divider" aria-hidden="true" />
          <SelectField className="design-workspace__current-file" aria-label={t('feature.design.documents')}
            title={documentRef.path} value={documentRef.path} valueContent={designFileParts(documentRef.path).name}
            menuAlign="start" renderOptionIcon={() => <Frame size={15} />} onValueChange={openFile}>
            {visiblePaths.map((item) => {
              const { name, folder } = designFileParts(item);
              return <option key={item} value={item}>{folder ? `${folder}/${name}` : name}</option>;
            })}
          </SelectField>
          {documentMenu(documentRef)}
          {createAction(<IconButton size="small" className="design-workspace__bar-create" label={t('feature.design.newDocument')}>
            <Plus size={17} />
          </IconButton>)}
        </nav>
        <div className="design-workspace__editor">
          <DesignDocumentSurface client={client} readOnly={mutatingFiles.current?.has(workspaceFileKey(documentRef))}
            documentRef={documentRef} watchChanges={watchChanges} watchAssetDirectories={watchAssetDirectories}
            layersToggleTarget={layersToggleTarget ?? undefined} onOpenLibrary={openFile} onDocumentMissing={backToDocuments} translate={t} />
        </div>
      </div>
    ) : <DesignWorkspaceHome scopeControls={scopeControls} files={files} onOpen={openListedDocument} renderFileAction={documentMenu} translate={t}
      createAction={catalog.length ? createAction(<Button variant="primary" className="design-workspace-home__create" icon={<Plus size={17} />}>
        {t('feature.design.newDocument')}
      </Button>) : <Button variant="primary" className="design-workspace-home__create" icon={<Plus size={17} />} onClick={props.onAddProject}>
        {t('feature.design.addProject')}
      </Button>} />}
  </div>;
}

function orderPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}
