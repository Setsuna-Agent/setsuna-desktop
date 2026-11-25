import type { RenderDesignChat } from './agent/DesignChatBridge.js';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { workspaceFilePathKey, workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { designDocumentFileName, designFileKey } from '../contracts/index.js';
import type { DesignLibraryColorScheme } from '../contracts/design-library-presets.js';
import { isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { ConfirmDialog, IconButton, useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignDocumentListEntry, DesignDocumentRef, DesignWorkspace as DesignScope } from '../contracts/index.js';
import { DesignCreateDocument } from './catalog/DesignCreateDocument.js';
import { DesignDocumentMenu } from './catalog/DesignDocumentMenu.js';
import { DesignDraftMenu } from './catalog/DesignDraftMenu.js';
import { DesignMoveForm } from './catalog/DesignMoveForm.js';
import { DesignProjectMenu, DesignScopeFields } from './catalog/DesignScopeFields.js';
import { DesignWorkspaceHome, designFileParts, type DesignCatalogFile, type DesignCatalogSection } from './catalog/DesignWorkspaceHome.js';
import { designHomeFilterForLocation, designHomeFilterForProjects, type DesignHomeFilter, type DesignWorkspaceLocation } from './catalog/design-workspace-location.js';
import type { DesignClient } from './client.js';
import { useDesignCatalog } from './catalog/use-design-catalog.js';
import { designListingKey, useDesignDocumentLists, type WatchDesignRootDirectories } from './catalog/use-design-document-lists.js';
import { useDesignProjectDrafts } from './catalog/use-design-project-drafts.js';
import { DesignEmptyProjectCanvas } from './document/DesignEmptyProjectCanvas.js';
import { DesignWorkspaceEditor } from './document/DesignWorkspaceEditor.js';
import { DesignPresetLibraryPreview } from './document/DesignPresetLibraryPreview.js';
import type { DesignLibraryPreviewTarget } from './DesignDocumentSurface.js';
import { withPausedDesignEdits } from './document/pending-design-edits.js';
import './design.css';
import './design-workspace.css';

export type { DesignWorkspaceLocation } from './catalog/design-workspace-location.js';

export type DesignWorkspaceProps = Readonly<{
  client: DesignClient;
  renderChat?: RenderDesignChat;
  projects: readonly WorkspaceProject[];
  visible?: boolean;
  location: DesignWorkspaceLocation | null;
  onLocationChange(location: DesignWorkspaceLocation | null): void;
  onBusyChange?(busy: boolean): void;
  watchDirectories: WatchDesignRootDirectories;
  locale?: string;
  colorScheme?: DesignLibraryColorScheme;
  translate: RendererTranslate;
}>;

type DocumentActionRequest = Readonly<{
  kind: 'move' | 'delete'; location: DesignWorkspaceLocation | null; menuKey: string; source: DesignDocumentRef;
  section: DesignCatalogSection;
}>;
const emptyEntries: readonly DesignDocumentListEntry[] = [];

export default function DesignWorkspace(props: DesignWorkspaceProps) {
  const { client, location, onLocationChange, onBusyChange, projects, visible = true, watchDirectories, translate: t } = props;
  const latestWorkspace = useRef({ location, visible });
  latestWorkspace.current = { location, visible };
  const resolvingSource = useRef<AbortController>();
  const creatingDraft = useRef(false);
  const [draftCreationPending, setDraftCreationPending] = useState(false);
  const [actionRequest, setActionRequest] = useState<DocumentActionRequest>();
  const [actionPending, setActionPending] = useState(false);
  const associatingDraft = useRef(false);
  const [busyDocuments, setBusyDocuments] = useState(() => new Map<string, DesignDocumentRef>());
  const [presetPreview, setPresetPreview] = useState<Readonly<{ ownerKey: string; source: DesignLibraryPreviewTarget }>>();
  const closePresetPreview = useCallback(() => setPresetPreview(undefined), []);
  const mutatingFiles = useRef<ReadonlySet<string>>();
  const mounted = useRef(false);
  const toast = useToast();
  const reportListFailure = useCallback((error: unknown) => {
    toast.error(t('feature.design.loadDocumentsFailed', { error: error instanceof Error ? error.message : String(error) }));
  }, [t, toast]);
  const { scopes: catalogScopes, projectFor, mayContainProjectDrafts, catalogReady, refresh: refreshCatalog, rememberDirectory } =
    useDesignCatalog(client, projects, t, reportListFailure);
  const catalog = useMemo(() => projects.map((project) => ({ id: project.id, name: project.name, icon: project.icon, roots: workspaceProjectRoots(project) })), [projects]);
  const projectsById = useMemo(() => new Map(catalog.map((project) => [project.id, project])), [catalog]);
  const requestedFilter = useMemo(() => designHomeFilterForLocation(location), [location]);
  const selectedProjectIds = useMemo(() => {
    const ids = requestedFilter?.projectIds ?? (requestedFilter?.projectId ? [requestedFilter.projectId] : []);
    return new Set(ids.filter((id) => projectsById.has(id)));
  }, [projectsById, requestedFilter]);
  const filteredProjectId = selectedProjectIds.size === 1 ? selectedProjectIds.values().next().value : undefined;
  const filteredProject = filteredProjectId ? projectsById.get(filteredProjectId) : undefined;
  const filterRootId = filteredProject?.roots.find(({ id }) => id === requestedFilter?.rootId)?.id;
  const homeFilter = useMemo(() => filteredProjectId && filterRootId
    ? { projectId: filteredProjectId, rootId: filterRootId } : designHomeFilterForProjects([...selectedProjectIds]),
  [filteredProjectId, filterRootId, selectedProjectIds]);
  const scopeFor = useCallback((ref: DesignScope) => catalogScopes.find(({ scope }) => ref.storageId !== undefined
    ? scope.storageId === ref.storageId : scope.projectId === ref.projectId && (!ref.rootId || ref.rootId === scope.rootId)), [catalogScopes]);
  const current = location?.path ? scopeFor(location) : undefined;
  const path = location?.path;
  const projectCanvas = location?.projectCanvas;
  const emptyProjectId = projectCanvas && !path ? location?.projectId : undefined;
  const projectId = current?.scope.projectId;
  const rootId = current?.scope.rootId;
  const storageId = location?.storageId;
  const documentRef = useMemo<DesignDocumentRef | null>(() => {
    if (!path) return null;
    if (storageId) return { storageId, path };
    return projectId ? { projectId, rootId, path } : null;
  }, [path, projectId, rootId, storageId]);
  const draftProjectId = emptyProjectId ?? (projectCanvas && documentRef ? homeFilter?.projectId : undefined);
  const projectDraftRoots = useMemo(() => {
    if (!visible || !draftProjectId) return [];
    const projectIds = new Set([draftProjectId]);
    // Chat-created drafts are linked to the project but saved in local storage.
    const roots = catalogScopes.filter((listing) => listing.scope.storageId === 'local' || mayContainProjectDrafts(listing, projectIds));
    return [...new Map(roots.map((listing) => [designListingKey(listing), listing.root.path])).values()];
  }, [catalogScopes, draftProjectId, mayContainProjectDrafts, visible]);
  const { projectDrafts, rememberProjectDrafts, refreshProjectDrafts } = useDesignProjectDrafts(
    client, visible ? draftProjectId : undefined, projectDraftRoots, watchDirectories, reportListFailure,
  );
  const scopes = useMemo(() => {
    if (!visible || emptyProjectId || draftProjectId) return [];
    return current ? [current] : path ? [] : catalogScopes;
  }, [catalogScopes, current, draftProjectId, emptyProjectId, path, visible]);
  const workspaceRoot = current?.root.path;
  const linkedProject = documentRef && workspaceRoot ? projectFor(documentRef, workspaceRoot) : null;
  const { lists, refresh: refreshLists } = useDesignDocumentLists(client, scopes, documentRef ? undefined : watchDirectories, reportListFailure);
  const activeDocumentKey = documentRef ? designFileKey(documentRef) : undefined;
  const preview = presetPreview?.ownerKey === activeDocumentKey ? presetPreview?.source : undefined;
  useEffect(() => { closePresetPreview(); }, [activeDocumentKey, closePresetPreview]);
  const latestDocument = useRef({ key: activeDocumentKey, homeFilter, projectCanvas });
  latestDocument.current = { key: activeDocumentKey, homeFilter, projectCanvas };
  const workspaceBusy = busyDocuments.size > 0;
  useLayoutEffect(() => {
    if (!workspaceBusy || !onBusyChange) return;
    onBusyChange(true);
    return () => onBusyChange(false);
  }, [workspaceBusy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    setActionRequest(undefined);
    return () => { resolvingSource.current?.abort(); };
  }, [location, visible]);
  const canRefresh = useCallback((ref: DesignDocumentRef) => !mutatingFiles.current?.has(designFileKey(ref)), []);
  const setDocumentBusy = useCallback((ref: DesignDocumentRef, busy: boolean) => {
    const key = designFileKey(ref);
    setBusyDocuments((previous) => {
      if (previous.has(key) === busy) return previous;
      const next = new Map(previous);
      if (busy) next.set(key, ref);
      else next.delete(key);
      return next;
    });
  }, []);
  const finishDocumentFileAction = useCallback((ref: DesignDocumentRef, destination?: DesignDocumentRef) => {
    setDocumentBusy(ref, false);
    const current = latestDocument.current;
    // A moved or deleted background draft must not replace the draft the user opened.
    if (current.key !== designFileKey(ref)) return;
    onLocationChange(destination ? documentLocation(destination, current.homeFilter, current.projectCanvas) : current.homeFilter);
  }, [onLocationChange, setDocumentBusy]);

  function backToDocuments() {
    resolvingSource.current?.abort();
    onLocationChange(homeFilter);
  }
  function openDocument(ref: DesignDocumentRef) {
    onLocationChange(documentLocation(ref, homeFilter, projectCanvas));
  }

  function resolveDestination<T>(load: (signal: AbortSignal) => Promise<T>, resolved: (result: T) => void, failed: (error: unknown) => void) {
    resolvingSource.current?.abort();
    const controller = new AbortController();
    resolvingSource.current = controller;
    const isCurrent = () => !controller.signal.aborted && mounted.current
      && latestWorkspace.current.visible && latestWorkspace.current.location === location;
    return load(controller.signal).then((result) => {
      if (isCurrent()) resolved(result);
    }).catch((error: unknown) => {
      if (isCurrent() && !isFeatureOperationCancelled(error)) failed(error);
    }).finally(() => { if (resolvingSource.current === controller) resolvingSource.current = undefined; });
  }

  function resolveDocumentSource(ref: DesignDocumentRef, resolved: (source: DesignDocumentRef) => void, failed: (error: unknown) => void) {
    void resolveDestination((signal) => client.resolveResourceRoot(ref, signal), resolved, failed);
  }

  function reportDocumentOpenFailure(error: unknown) {
    toast.error(t('feature.design.loadFailed', { error: error instanceof Error ? error.message : String(error) }));
  }

  function openListedDocument(ref: DesignDocumentRef) {
    resolveDocumentSource(ref, openDocument, reportDocumentOpenFailure);
  }

  function openProject(projectId: string) {
    void resolveDestination(async (signal) => {
      const entries = await client.projectDesigns(projectId, signal);
      signal.throwIfAborted();
      const first = entries[0];
      try {
        return { entries, ref: first ? await client.resolveResourceRoot(first.ref, signal) : null };
      } catch (error) {
        if (signal.aborted || isFeatureOperationCancelled(error)) throw error;
        return { entries, ref: null, error };
      }
    }, (result) => {
      const { entries, ref } = result;
      rememberProjectDrafts({ projectId, entries });
      onLocationChange(ref ? documentLocation(ref, { projectId }, true) : { projectId, projectCanvas: true });
      if ('error' in result) reportDocumentOpenFailure(result.error);
    }, reportDocumentOpenFailure);
  }

  async function createCanvasDraft() {
    if (creatingDraft.current) return;
    const targetProjectId = emptyProjectId ?? draftProjectId ?? linkedProject ?? documentRef?.projectId;
    const project = catalog.find(({ id }) => id === targetProjectId);
    const firstRoot = project?.roots[0];
    const scope: DesignScope = current?.scope ?? (project && firstRoot && !documentRef
      ? { projectId: project.id, rootId: firstRoot.id } : { storageId: documentRef?.storageId ?? 'local' });
    const parentPath = documentRef ? designFileParts(documentRef.path).folder || '.' : '.';
    const linkedProjectId = project?.id !== scope.projectId ? project?.id : undefined;
    const name = designDocumentFileName(t('feature.design.newDraft'));
    creatingDraft.current = true;
    setDraftCreationPending(true);
    try {
      // If the user navigates away, let the save finish without opening it over their new view.
      await resolveDestination(async () => {
        const entry = await client.create({ ...scope, parentPath, name, autoNumber: true, ...(linkedProjectId ? { linkedProjectId } : {}) });
        if (mounted.current) {
          refreshLists();
          refreshProjectDrafts();
          if (linkedProjectId) void refreshCatalog();
        }
        return { ...scope, path: entry.path };
      }, openDocument, (error) => {
        toast.error(t('feature.design.createDocumentFailed', { error: error instanceof Error ? error.message : String(error) }));
      });
    } finally {
      creatingDraft.current = false;
      if (mounted.current) setDraftCreationPending(false);
    }
  }

  async function chooseDirectory() {
    if (!client.assets.chooseDirectory) throw new Error(t('feature.design.chooseLocation'));
    const chosen = await client.assets.chooseDirectory();
    if (chosen && mounted.current) rememberDirectory(chosen);
    return chosen;
  }

  async function create(scope: DesignScope, name: string, linkedProjectId?: string) {
    const entry = await client.create({ ...scope, parentPath: '.', name, ...(linkedProjectId ? { linkedProjectId } : {}) });
    if (!mounted.current) return;
    refreshLists();
    if (linkedProjectId) void refreshCatalog();
    if (latestWorkspace.current.location !== location || !latestWorkspace.current.visible) return;
    const ref = { ...scope, path: entry.path };
    onLocationChange(linkedProjectId ? documentLocation(ref, { projectId: linkedProjectId }, true) : documentLocation(ref, homeFilter));
  }

  const closeAction = () => setActionRequest(undefined);
  function reportActionFailure(kind: DocumentActionRequest['kind'], error: unknown) {
    toast.error(t(kind === 'move' ? 'feature.design.moveDocumentFailed' : 'feature.design.deleteDocumentFailed', {
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  async function changeDocumentProject(file: DesignCatalogFile, projectId: string | null) {
    if (associatingDraft.current || mutatingFiles.current) return;
    associatingDraft.current = true;
    resolvingSource.current?.abort();
    closeAction();
    setActionPending(true);
    try {
      const { document } = await client.read(file.ref);
      await client.setProject({ ref: file.ref, documentId: document.documentId }, projectId);
      if (!mounted.current) return;
      await refreshCatalog();
    } catch (error: unknown) {
      if (mounted.current && !isFeatureOperationCancelled(error)) {
        toast.error(t('feature.design.linkProjectFailed', { error: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      associatingDraft.current = false;
      if (mounted.current) setActionPending(false);
    }
  }

  function documentMenu(file: DesignCatalogFile, section: DesignCatalogSection) {
    const { ref, projectId } = file;
    const name = designFileParts(ref.path).name;
    const menuKey = designFileKey(ref);
    // The same design has a separate menu in each catalog section.
    const action = visible && actionRequest?.location === location && actionRequest.menuKey === menuKey && actionRequest.section === section
      ? actionRequest : undefined;
    const form = action?.kind === 'move' ? {
      label: t('feature.design.moveDocumentTitle', { name }),
      content: <DesignMoveForm source={action.source} choose={chooseDirectory} pending={actionPending}
        onMove={(destination) => { void runDocumentAction((ref) => client.move({ ref, destination }), openDocument); }}
        onClose={closeAction} translate={t} />,
    } : undefined;
    return <>
      <DesignDocumentMenu name={name} translate={t} disabled={actionPending} form={form} onCloseForm={closeAction}
        projectId={projectId} projects={catalog} onChangeProject={(next) => { void changeDocumentProject(file, next); }}
        onMove={() => {
          closeAction();
          resolveDocumentSource(ref, (source) => setActionRequest({ kind: 'move', location, menuKey, source, section }),
            (error) => reportActionFailure('move', error));
        }}
        onDelete={() => {
          resolvingSource.current?.abort();
          setActionRequest({ kind: 'delete', location, menuKey, source: ref, section });
        }} />
      {action?.kind === 'delete' ? <ConfirmDialog open danger pending={actionPending}
        title={t('feature.design.deleteDocumentTitle', { path: action.source.path })}
        description={t('feature.design.deleteDocumentPermanent')} confirmLabel={t('feature.design.deleteDocument')}
        cancelLabel={t('feature.design.cancel')} onClose={closeAction} onConfirm={() => { void runDocumentAction(client.delete); }} /> : null}
    </>;
  }

  async function runDocumentAction<T>(operation: (ref: DesignDocumentRef) => Promise<T>, complete?: (result: T) => void) {
    if (!actionRequest || mutatingFiles.current || associatingDraft.current) return;
    const { source, menuKey, kind, location: startedAt } = actionRequest;
    const isCurrent = () => mounted.current && latestWorkspace.current.visible && latestWorkspace.current.location === startedAt;
    const keys = new Set([menuKey, designFileKey(source)]);
    mutatingFiles.current = keys;
    setActionPending(true);
    try {
      await withPausedDesignEdits(client, keys, async () => {
        if (!isCurrent()) return;
        const result = await operation(source);
        setDocumentBusy(source, false);
        if (!isCurrent()) return;
        setActionRequest(undefined);
        refreshLists();
        void refreshCatalog();
        complete?.(result);
      });
    } catch (error: unknown) {
      if (isCurrent() && !isFeatureOperationCancelled(error)) reportActionFailure(kind, error);
    } finally {
      mutatingFiles.current = undefined;
      if (mounted.current) setActionPending(false);
    }
  }

  const paths = current ? (lists.get(designListingKey(current)) ?? emptyEntries).filter((entry) => !entry.libraryPreset).map(({ path }) => path) : [];
  const visiblePaths = path && !paths.includes(path) ? orderPaths([...paths, path]) : paths;
  function draftKey(ref: DesignDocumentRef) {
    const root = scopeFor(ref)?.root.path;
    return root ? workspaceFilePathKey(root, ref.path) : designFileKey(ref);
  }
  const drafts = projectDrafts?.map(({ ref }) => ref) ?? (documentRef ? visiblePaths.map((path) => ({ ...documentRef, path })) : []);
  const draftChoices = new Map(drafts.map((ref) => [draftKey(ref), ref]));
  const selectedDraft = documentRef ? draftKey(documentRef) : '';
  if (documentRef && !draftChoices.has(selectedDraft)) draftChoices.set(selectedDraft, documentRef);
  function openFile(item: string) {
    if (documentRef && item !== documentRef.path) openListedDocument({ ...documentRef, path: item });
  }
  const { files, revisions } = useMemo(() => {
    const revisions = new Map<string, string>();
    if (documentRef) return { files: [], revisions };
    const byPath = new Map<string, DesignCatalogFile>();
    for (const scope of scopes) {
      for (const { path, modifiedAt, revision, libraryPreset } of lists.get(designListingKey(scope)) ?? emptyEntries) {
        const pathKey = workspaceFilePathKey(scope.root.path, path);
        revisions.set(pathKey, revision ?? modifiedAt ?? '');
        if (libraryPreset) continue;
        const ref = { ...scope.scope, path };
        const projectId = projectFor(ref, scope.root.path) ?? null;
        if (selectedProjectIds.size && (projectId === null || !selectedProjectIds.has(projectId))) continue;
        if (filterRootId && (scope.scope.projectId !== filteredProjectId || scope.scope.rootId !== filterRootId)) continue;
        const listed = byPath.get(pathKey);
        // For the same absolute file, the shortest relative route starts at the deepest bound root.
        if (listed && listed.ref.path.split('/').length <= path.split('/').length) continue;
        const project = projectId ? projectsById.get(projectId) : undefined;
        byPath.set(pathKey, { pathKey, ref, root: scope.root, source: scope.source, projectId, project, modifiedAt, revision });
      }
    }
    return { files: [...byPath.values()], revisions };
  }, [documentRef, filteredProjectId, filterRootId, lists, projectFor, projectsById, scopes, selectedProjectIds]);
  const fileRevision = useCallback((ref: DesignDocumentRef) => {
    const root = scopeFor(ref)?.root.path;
    return root ? revisions.get(workspaceFilePathKey(root, ref.path)) : undefined;
  }, [revisions, scopeFor]);
  const emptyStateListingKeys = useMemo(() => scopes.filter((listing) => {
    if (!selectedProjectIds.size) return true;
    if (filterRootId) return listing.scope.projectId === filteredProjectId && listing.scope.rootId === filterRootId;
    return mayContainProjectDrafts(listing, selectedProjectIds);
  }).map(designListingKey), [scopes, selectedProjectIds, filteredProjectId, filterRootId, mayContainProjectDrafts]);
  const showEmptyState = visible && !path && !emptyProjectId && files.length === 0 && catalogReady
    && emptyStateListingKeys.every((key) => lists.has(key))
    && (emptyStateListingKeys.length === 0 || emptyStateListingKeys.some((key) => lists.get(key) != null));
  const toolbar = documentRef || emptyProjectId ? <nav className="design-workspace__bar" aria-label={t('feature.design.documents')}>
    <IconButton size="small" label={t('feature.design.backToDocuments')} onClick={backToDocuments}>
      <ArrowLeft size={17} />
    </IconButton>
    <div className="design-workspace__bar-fields">
      <DesignProjectMenu projects={catalog} projectId={draftProjectId ?? linkedProject ?? null}
        onSelect={openProject} translate={t} />
      <DesignDraftMenu drafts={draftChoices} documentRef={documentRef} selected={selectedDraft} creating={draftCreationPending}
        onCreate={() => { void createCanvasDraft(); }} onOpen={openListedDocument} translate={t} />
    </div>
  </nav> : null;
  const openDocuments = new Map(busyDocuments);
  if (documentRef && activeDocumentKey && !openDocuments.has(activeDocumentKey)) openDocuments.set(activeDocumentKey, documentRef);
  return <div className="design-workspace" data-visible={visible}>
    {[...openDocuments].map(([key, ref]) => {
      const current = key === activeDocumentKey;
      const selected = current && !preview;
      const root = current ? workspaceRoot : scopeFor(ref)?.root.path;
      return <DesignWorkspaceEditor key={key} selected={selected} visible={selected && visible} toolbar={selected ? toolbar : undefined}
        documentRef={ref} client={client} projects={projects} renderChat={props.renderChat} colorScheme={props.colorScheme} translate={t}
        linkedProject={root ? projectFor(ref, root) ?? null : null} workspaceRoot={root} watchDirectories={watchDirectories} canRefresh={canRefresh}
        onOpenLibrary={selected ? openFile : undefined} onOpenPresetLibrary={selected ? (source) => {
          if (latestDocument.current.key === key && latestWorkspace.current.visible) setPresetPreview({ ownerKey: key, source });
        } : undefined} onDocumentBusy={setDocumentBusy} onDocumentFileAction={finishDocumentFileAction} />;
    })}
    {preview && documentRef ? <DesignPresetLibraryPreview source={preview} colorScheme={props.colorScheme ?? 'light'}
      documentRef={documentRef} client={client} visible={visible} watchDirectories={watchDirectories}
      onClose={closePresetPreview} translate={t} /> : null}
    {emptyProjectId ? <DesignEmptyProjectCanvas toolbar={toolbar} showEmptyState={projectDrafts?.length === 0} translate={t} /> : null}
    {!documentRef && !emptyProjectId && <DesignWorkspaceHome client={client} files={files} fileRevision={fileRevision} showEmptyState={showEmptyState}
      onOpen={openListedDocument} renderFileAction={documentMenu} visible={visible} locale={props.locale} translate={t}
      scopeControls={<DesignScopeFields projects={catalog} scope={homeFilter} onChange={onLocationChange} translate={t} />}
      createAction={<DesignCreateDocument key={JSON.stringify(homeFilter)} projects={catalog} defaultProjectId={homeFilter?.projectId}
        chooseDirectory={chooseDirectory} onCreate={create} translate={t} />} />}
  </div>;
}

function documentLocation(ref: DesignDocumentRef, homeFilter: DesignHomeFilter | null, projectCanvas?: true): DesignWorkspaceLocation {
  return { ...ref, ...(homeFilter ? { homeFilter } : {}), ...(projectCanvas ? { projectCanvas } : {}) };
}

function orderPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}
