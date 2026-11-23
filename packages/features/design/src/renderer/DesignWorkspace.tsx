import type { RenderDesignChat } from './agent/DesignChatBridge.js';
import { ArrowLeft, Frame, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { workspaceFilePathKey, workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { designFileKey } from '../contracts/index.js';
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
import { useDesignCatalog } from './catalog/use-design-catalog.js';
import { designListingKey, useDesignDocumentLists, type WatchDesignRootDirectories } from './catalog/use-design-document-lists.js';
import { withPausedDesignEdits } from './document/pending-design-edits.js';
import './design.css';
import './design-workspace.css';

export type DesignWorkspaceLocation = DesignScope & Readonly<{ path?: string; homeFilter?: DesignScope }>;

export type DesignWorkspaceProps = Readonly<{
  client: DesignClient;
  renderChat?: RenderDesignChat;
  projects: readonly WorkspaceProject[];
  location: DesignWorkspaceLocation | null;
  onLocationChange(location: DesignWorkspaceLocation | null): void;
  watchDirectories: WatchDesignRootDirectories;
  translate: RendererTranslate;
}>;

type DocumentActionRequest = Readonly<{
  kind: 'move' | 'delete'; location: DesignWorkspaceLocation | null; menuKey: string; source: DesignDocumentRef;
}>;
const emptyPaths: readonly string[] = [];

export default function DesignWorkspace(props: DesignWorkspaceProps) {
  const { client, location, onLocationChange, projects, watchDirectories, translate: t } = props;
  const latestLocation = useRef(location);
  latestLocation.current = location;
  const resolvingSource = useRef<AbortController>();
  const [actionRequest, setActionRequest] = useState<DocumentActionRequest>();
  const [actionPending, setActionPending] = useState(false);
  const mutatingFiles = useRef<ReadonlySet<string>>();
  const mounted = useRef(false);
  const toast = useToast();
  const reportListFailure = useCallback((error: unknown) => {
    toast.error(t('feature.design.loadDocumentsFailed', { error: error instanceof Error ? error.message : String(error) }));
  }, [t, toast]);
  const { scopes: catalogScopes, projectFor, refresh: refreshCatalog, rememberDirectory } = useDesignCatalog(client, projects, t, reportListFailure);
  const catalog = useMemo(() => projects.map((project) => ({ id: project.id, name: project.name, roots: workspaceProjectRoots(project) })), [projects]);
  const requestedFilter = location?.path ? location.homeFilter : location;
  const filteredProject = catalog.find(({ id }) => id === requestedFilter?.projectId);
  const filterRootId = filteredProject?.roots.find(({ id }) => id === requestedFilter?.rootId)?.id;
  const homeFilter = useMemo(() => filteredProject
    ? { projectId: filteredProject.id, ...(filterRootId ? { rootId: filterRootId } : {}) } : null, [filteredProject, filterRootId]);
  const current = location?.path ? catalogScopes.find(({ scope }) => location.storageId !== undefined
    ? scope.storageId === location.storageId : scope.projectId === location.projectId && (!location.rootId || location.rootId === scope.rootId)) : undefined;
  const path = location?.path;
  const projectId = current?.scope.projectId;
  const rootId = current?.scope.rootId;
  const storageId = location?.storageId;
  const documentRef = useMemo<DesignDocumentRef | null>(() => {
    if (!path) return null;
    if (storageId) return { storageId, path };
    return projectId ? { projectId, rootId, path } : null;
  }, [path, projectId, rootId, storageId]);
  const scopes = useMemo(() => current ? [current] : path ? [] : catalogScopes, [current, path, catalogScopes]);
  const workspaceRoot = current?.root.path;
  const linkedProject = documentRef && workspaceRoot ? projectFor(documentRef, workspaceRoot) : null;
  const { lists, refresh: refreshLists } = useDesignDocumentLists(client, scopes, documentRef ? undefined : watchDirectories, reportListFailure);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; resolvingSource.current?.abort(); };
  }, []);
  const watchAssetDirectories = useCallback<WatchDesignDirectories>((directories, changed, options) =>
    workspaceRoot ? watchDirectories(workspaceRoot, directories, changed, options) : () => undefined, [watchDirectories, workspaceRoot]);
  const shouldRefresh = useCallback(() => !documentRef || !mutatingFiles.current?.has(designFileKey(documentRef)), [documentRef]);

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
    return <DesignCreateDocument key={documentRef ? designFileKey(documentRef) : JSON.stringify(homeFilter)}
      chooseDirectory={chooseDirectory} onCreate={create} translate={t}>{trigger}</DesignCreateDocument>;
  }

  async function chooseDirectory() {
    if (!client.assets.chooseDirectory) throw new Error(t('feature.design.chooseLocation'));
    const chosen = await client.assets.chooseDirectory();
    if (chosen && mounted.current) rememberDirectory(chosen);
    return chosen;
  }

  async function associate(projectId: string | null) {
    if (!documentRef || actionPending) return;
    setActionPending(true);
    try {
      const { document } = await client.read(documentRef);
      await client.setProject({ ref: documentRef, documentId: document.documentId }, projectId);
      if (mounted.current) await refreshCatalog();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setActionPending(false); }
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
    const menuKey = designFileKey(ref);
    const action = actionRequest?.location === location && actionRequest.menuKey === menuKey ? actionRequest : undefined;
    const deleteTitle = t('feature.design.deleteDocumentTitle', { path: ref.path });
    const form = action?.kind === 'move' ? {
      label: t('feature.design.moveDocumentTitle', { name }), compact: true,
      content: <DesignMoveForm source={action.source} choose={chooseDirectory} pending={actionPending}
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
            onClick={() => { void runDocumentAction(client.delete); }}>
            {t('feature.design.deleteDocument')}
          </Button>
        </div>
      </div>,
    } : undefined;
    return <DesignDocumentMenu name={name} translate={t} placement={documentRef ? 'bottomLeft' : 'bottomRight'} disabled={actionPending} form={form} onCloseForm={closeAction}
      onMove={() => {
        closeAction();
        resolveDocumentSource(ref, (source) => setActionRequest({ kind: 'move', location, menuKey, source }),
          (error) => reportActionFailure('move', error));
      }}
      onDelete={() => {
        resolvingSource.current?.abort();
        setActionRequest({ kind: 'delete', location, menuKey, source: ref });
      }} />;
  }

  async function runDocumentAction<T>(operation: (ref: DesignDocumentRef) => Promise<T>, complete?: (result: T) => void) {
    if (!actionRequest || mutatingFiles.current) return;
    const { source, menuKey, kind, location: startedAt } = actionRequest;
    const isCurrent = () => mounted.current && latestLocation.current === startedAt;
    const keys = new Set([menuKey, designFileKey(source)]);
    mutatingFiles.current = keys;
    setActionPending(true);
    try {
      await withPausedDesignEdits(client, keys, async () => {
        if (!isCurrent()) return;
        const result = await operation(source);
        if (!isCurrent()) return;
        setActionRequest(undefined);
        refreshLists();
        void refreshCatalog();
        if (complete) complete(result);
        else if (documentRef && kind === 'delete') backToDocuments();
      });
    } catch (error: unknown) {
      if (isCurrent() && !isFeatureOperationCancelled(error)) reportActionFailure(kind, error);
    } finally {
      mutatingFiles.current = undefined;
      if (mounted.current) setActionPending(false);
    }
  }

  const paths = current ? lists.get(designListingKey(current)) ?? emptyPaths : emptyPaths;
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
        const ref = { ...scope.scope, path };
        if (homeFilter && (projectFor(ref, scope.root.path) !== homeFilter.projectId
          || (homeFilter.rootId && (scope.scope.projectId !== homeFilter.projectId || scope.scope.rootId !== homeFilter.rootId)))) continue;
        const listed = byPath.get(pathKey);
        // For the same absolute file, the shortest relative route starts at the deepest bound root.
        if (listed && listed.ref.path.split('/').length <= path.split('/').length) continue;
        byPath.set(pathKey, { pathKey, ref, source: scope.source });
      }
    }
    return [...byPath.values()];
  }, [documentRef, homeFilter, lists, projectFor, scopes]);
  const scopeControls = documentRef ? <DesignScopeFields projects={catalog} scope={linkedProject ? { projectId: linkedProject } : null}
    mode="association" disabled={actionPending} onChange={(scope) => { void associate(scope?.projectId ?? null); }} translate={t} />
    : <DesignScopeFields projects={catalog} scope={homeFilter} mode="filter" onChange={onLocationChange} translate={t} />;
  return <div className="design-workspace">
    {documentRef ? (
      <div className="design-workspace__editing">
        <nav className="design-workspace__bar" aria-label={t('feature.design.documents')}>
          <IconButton size="small" label={t('feature.design.backToDocuments')} onClick={backToDocuments}>
            <ArrowLeft size={17} />
          </IconButton>
          {scopeControls}
          {documentMenu(documentRef)}
          <span className="design-workspace__bar-divider" aria-hidden="true" />
          <SelectField className="design-workspace__current-file" aria-label={t('feature.design.documents')}
            title={documentRef.path} value={documentRef.path} valueContent={designFileParts(documentRef.path).name}
            menuAlign="start" renderOptionIcon={() => <Frame size={15} />} onValueChange={openFile}>
            {visiblePaths.map((item) => {
              const { name, folder } = designFileParts(item);
              return <option key={item} value={item}>{folder ? `${folder}/${name}` : name}</option>;
            })}
          </SelectField>
          {createAction(<IconButton size="small" label={t('feature.design.newDocument')}>
            <Plus size={17} />
          </IconButton>)}
        </nav>
        <div className="design-workspace__editor">
          <DesignDocumentSurface renderChat={props.renderChat && ((binding) => props.renderChat?.(binding, linkedProject ?? null))} client={client} projects={projects} onFileAction={(destination) => {
            if (destination) openDocument(destination); else backToDocuments();
          }} readOnly={mutatingFiles.current?.has(designFileKey(documentRef))}
            documentRef={documentRef} shouldRefresh={shouldRefresh} watchAssetDirectories={watchAssetDirectories}
            onOpenLibrary={openFile} onDocumentMissing={backToDocuments} translate={t} />
        </div>
      </div>
    ) : <DesignWorkspaceHome scopeControls={scopeControls} files={files} onOpen={openListedDocument} renderFileAction={documentMenu} translate={t}
      createAction={createAction(<Button variant="primary" className="design-workspace-home__create" icon={<Plus size={17} />}>
        {t('feature.design.newDocument')}
      </Button>)} />}
  </div>;
}

function orderPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}
