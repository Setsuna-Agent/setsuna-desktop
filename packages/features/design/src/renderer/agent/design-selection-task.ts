import type { DesignCommandKey } from '../../contracts/design-command-key.js';
import type { DesignSnapshot } from '../../contracts/index.js';
import type { DesignAgent, DesignTaskClient, DesignTaskResult, DesignTaskStep } from '../../contracts/design-task.js';
import type { DesignDocumentRef } from '../../contracts/operations.js';
import { selectedBranches } from '../design-canvas-edits.js';
import { designAgentFocus, type DesignAgentFocus } from './design-agent-focus.js';
import type { DesignCommandContext } from './design-command.js';
import { designLayerEntry, inspectDesignLayers } from './design-layer-inspection.js';
import { planEditorCommand } from './design-advanced-commands.js';
import { readDesignResources, exportDesignTask, importDesignResource, manageDesignFile, type DesignEditorTools } from './design-editor-tools.js';
import { advanceDesignPrototype, designPrototypeBoardFor, designPrototypeBoards, designPrototypeHotspots, type PrototypeState } from '../prototype/design-prototype.js';

export type DesignTaskView = DesignCommandContext & {
  editor?: DesignEditorTools;
  setNetworkAccess?(allowed: boolean): void;
  showFocus?(focus: DesignAgentFocus | undefined, deleted?: boolean, agent?: DesignAgent): void;
  preview(ids: readonly string[], signal: AbortSignal, networkAccess: boolean): Promise<{ image: string; bounds: unknown }>;
};

function permits(view: DesignTaskView, roots: ReadonlySet<string> | undefined, id: string) {
  if (!Object.hasOwn(view.scene, id)) return false;
  if (!roots) return true;
  for (let ancestor: string | null = id; ancestor; ancestor = view.scene[ancestor]?.parentId ?? null) {
    if (roots.has(ancestor)) return true;
  }
  return false;
}

function targets(view: DesignTaskView, roots: ReadonlySet<string> | undefined, requested: unknown, exact = false) {
  if (!Array.isArray(requested) || requested.some((id) => typeof id !== 'string' || !Object.hasOwn(view.scene, id))) throw new Error('Unknown layer in the current draft.');
  if (roots && requested.some((id) => !permits(view, roots, id))) throw new Error('Select the target layers with design_view({action:"select",ids:[...]}) before editing them.');
  const ids = [...new Set<string>(requested)];
  return exact ? ids : selectedBranches(ids, view.scene);
}

type DesignSelectionTask = {
  sessionId?: string; clientId?: string; client: DesignTaskClient; ref: DesignDocumentRef; selection: readonly string[]; threadId: string; onReady(): void; signal: AbortSignal;
  approve(tool: string, description: string, signal: AbortSignal): Promise<boolean>; view(): DesignTaskView; synchronize(signal: AbortSignal): Promise<DesignSnapshot>;
};

function designParticipant(input: DesignSelectionTask, sourceId: string, agent?: DesignAgent) {
  const { signal } = input;
  let roots = input.selection.length ? new Set(input.selection) : undefined;
  let focus: readonly string[] | undefined = input.selection.length ? input.selection : undefined;
  let pendingEdit: { selection: readonly string[]; deletion?: DesignAgentFocus; insertedIds: string[] } | undefined;
  let prototype: PrototypeState | undefined;
  function showTargets(view: DesignTaskView, ids: readonly string[]) {
    const focus = designAgentFocus(view.projected, view.scene, ids);
    view.showFocus?.(focus, false, agent);
    return focus;
  }

  async function process(step: Extract<DesignTaskStep, { kind: 'tool' }>, signal: AbortSignal, command: DesignCommandKey): Promise<DesignTaskResult> {
    const snapshot = await input.synchronize(signal);
    signal.throwIfAborted();
    const view = input.view();
    if (snapshot.document.documentId !== sourceId || view.document !== snapshot.document) throw new Error('Design document changed.');
    const { name, args } = step;
    view.setNetworkAccess?.(step.networkAccess === true);
    const selection = focus?.filter((id) => Object.hasOwn(view.scene, id));
    if (name === 'design_inspect') {
      const searchDraft = args.scope === 'document' || (args.scope === undefined && args.name !== undefined);
      const fallback = searchDraft ? view.document.rootIds : selection ?? (args.scope === 'selection' ? [] : view.document.rootIds);
      const ids = targets(view, undefined, args.ids ?? fallback);
      const { content, focusIds } = await inspectDesignLayers(view, ids, snapshot.revision, args,
        searchDraft || (!roots && args.scope !== 'selection'), selection ?? []);
      signal.throwIfAborted();
      showTargets(view, focusIds);
      return { content };
    }
    const browse = name === 'design_preview' || name === 'design_view';
    const individual = (name === 'design_view' && args.action === 'select') || (name === 'design_edit' && (args.action === 'update' || args.action === 'bindTokens'));
    const ids = targets(view, browse ? undefined : roots, args.ids ?? selection ?? view.document.rootIds, individual);
    if (name === 'design_preview') {
      showTargets(view, ids);
      const { image, bounds } = await view.preview(ids, signal, step.networkAccess === true);
      return { content: JSON.stringify({ revision: snapshot.revision, ids, bounds }), image };
    }
    if (name === 'design_edit') {
      if (args.revision !== snapshot.revision) throw new Error(JSON.stringify({ applied: false, code: 'REVISION_CONFLICT', revision: snapshot.revision, error: 'Design revision changed. Inspect before editing again.' }));
      const plan = await planEditorCommand(view, view.editor, ids, args, !roots, (id) => permits(view, roots, id), signal);
      if (!step.networkAccess && args.dryRun !== true) {
        (await import('./design-edit-preflight.js')).checkInstanceWebLayers(view, plan.edits);
      }
      const layout = args.dryRun === true
        ? (await import('./design-edit-preflight.js')).inspectPlannedLayout(view, roots, snapshot.revision, plan) : undefined;
      if (args.dryRun !== true && plan.edits.length) {
        signal.throwIfAborted();
        const deleting = args.action === 'delete';
        const existing = plan.ids.filter((id) => Object.hasOwn(view.scene, id));
        const focus = deleting || plan.ids.length ? showTargets(view, existing.length ? existing : ids) : undefined;
        const insertedIds = args.action === 'insert' || args.action === 'insertSvg'
          ? plan.edits.flatMap((e) => e.kind === 'insert' ? [e.nodeId] : []) : [];
        pendingEdit = { selection: plan.ids, deletion: deleting ? focus : undefined, insertedIds };
      }
      return { content: JSON.stringify({ ids: plan.ids.slice(0, 64), count: plan.ids.length, changes: plan.edits.length, layout }), plan: { revision: snapshot.revision, edits: [...plan.edits] } };
    }
    if (name === 'design_prototype') {
      const boards = designPrototypeBoards(view.projected, view.scene);
      const board = designPrototypeBoardFor(ids[0] ?? null, view.scene);
      const start = board && boards.includes(board) ? board : !roots ? boards[0] : undefined;
      if (!start) throw new Error('Select a prototype board.');
      if (!prototype || args.action === 'start' || args.action === 'restart') prototype = { board: start, history: [], overlays: [] };
      const hotspots = () => designPrototypeHotspots(view.projected, view.scene, prototype!.overlays.at(-1) ?? prototype!.board);
      if (args.action === 'click') {
        const hotspot = hotspots().find(({ id }) => id === args.id);
        if (!hotspot) throw new Error('Choose a hotspot on the current board.');
        prototype = advanceDesignPrototype(prototype, hotspot.interaction, boards);
      } else if (args.action === 'back') prototype = advanceDesignPrototype(prototype, { kind: 'back' }, boards);
      return { content: JSON.stringify({ ...prototype, hotspots: hotspots() }) };
    }
    if (name === 'design_view' && args.action === 'select') {
      if (ids.some((id) => !Object.hasOwn(view.document.nodes, id))) throw new Error('Select the authored instance to edit projected content.');
      if (!agent) {
        if (!view.editor) throw new Error('Editor service unavailable.');
        view.editor.select(ids);
      }
      showTargets(view, ids);
      focus = ids;
      if (roots && args.ids !== undefined) roots = new Set(ids);
      return { content: JSON.stringify({ ids: ids.slice(0, 64) }) };
    }
    const editor = view.editor;
    if (!editor) throw new Error('Editor service unavailable.');
    switch (name) {
      case 'design_resources': return { content: JSON.stringify(await readDesignResources(view, editor, args, signal)) };
      case 'design_export': return { content: JSON.stringify({ exported: await exportDesignTask(view, editor, ids, args, signal, step.networkAccess === true) }) };
      case 'design_view': {
        const canvas = editor.canvas();
        if (!canvas) throw new Error('Canvas unavailable.');
        if (args.action === 'fit') {
          canvas.fitLayers(ids);
          showTargets(view, ids);
        } else if (args.action === 'zoom' && typeof args.scale === 'number' && Number.isFinite(args.scale) && args.scale > 0) canvas.zoomTo(args.scale);
        else if (args.action === 'pan' && typeof args.x === 'number' && Number.isFinite(args.x) && typeof args.y === 'number' && Number.isFinite(args.y)) {
          canvas.panBy({ x: args.x, y: args.y });
        } else if (args.action === 'settings') {
          const key = args.key;
          if (key === undefined) return { content: JSON.stringify(editor.settings) };
          if ((key !== 'showPixelGrid' && key !== 'snapToObjects' && key !== 'snapToPixelGrid') || typeof args.enabled !== 'boolean') throw new Error('Invalid canvas setting.');
          if (editor.settings[key] !== args.enabled) editor.toggleSetting(key);
        } else throw new Error('Invalid canvas action.');
        return { content: JSON.stringify({ ids: ids.slice(0, 64) }) };
      }
      case 'design_asset': {
        if (args.action === 'removeFont' && !await input.approve(editor.translate('feature.design.removeFont'), String(args.id), signal)) throw new Error('Font removal declined.');
        signal.throwIfAborted();
        return { content: JSON.stringify(await importDesignResource(editor, args, !roots, signal, command)) };
      }
      case 'design_document': {
        if (roots) throw new Error('Start a whole-document task to manage this draft.');
        if (args.action === 'delete' || args.action === 'move') {
          if (!editor.completeFileAction) throw new Error('Open the draft in the Design workspace.');
          const destination = args.action === 'move' ? ' → ' + String(args.projectId) + '/' + String(args.rootId) : '';
          if (!await input.approve(editor.translate(args.action === 'delete' ? 'feature.design.deleteDocument' : 'feature.design.moveDocument'), editor.ref.path + destination, signal)) throw new Error('File operation declined.');
        }
        signal.throwIfAborted();
        return { content: JSON.stringify(await manageDesignFile(editor, args, snapshot.revision, signal, command)) };
      }
    }
  }
  async function acknowledge(step: Extract<DesignTaskStep, { kind: 'applied' }>) {
    const next = await input.synchronize(signal);
    signal.throwIfAborted();
    if (next.document.documentId !== sourceId) throw new Error('Design document changed.');
    const applied = pendingEdit;
    pendingEdit = undefined;
    const matches = next.revision === step.revision;
    const current = input.view();
    if (applied) {
      const existing = applied.selection.filter((id) => Object.hasOwn(next.document.nodes, id));
      existing.forEach((id) => roots?.add(id));
      if (matches) {
        focus = existing;
        if (!agent) current.editor?.select(existing);
        if (applied.deletion) current.showFocus?.(applied.deletion, true, agent);
        else showTargets(current, existing);
      }
    }
    if (!matches) current.showFocus?.(undefined, false, agent);
    const inserted = matches && applied?.insertedIds.length ? applied.insertedIds.slice(0, 256).map((id) => designLayerEntry(current, id)) : undefined;
    return { content: JSON.stringify({ refreshed: matches, inserted, insertedCount: inserted && applied?.insertedIds.length }) };
  }
  return { acknowledge, process(step: Extract<DesignTaskStep, { kind: 'tool' }>, signal: AbortSignal, command: DesignCommandKey) {
    // A rejected write has no acknowledgement. Drop only this agent's provisional highlight.
    if (pendingEdit) input.view().showFocus?.(undefined, false, agent);
    pendingEdit = undefined;
    return process(step, signal, command);
  } };
}

// Command leases can expire while the editor is waiting for a human decision.
async function runEditorCommand(client: DesignTaskClient, sessionId: string, step: Extract<DesignTaskStep, { kind: 'tool' }>, session: AbortSignal,
  run: (signal: AbortSignal, command: DesignCommandKey) => Promise<DesignTaskResult>) {
  const controller = new AbortController();
  const signal = AbortSignal.any([session, controller.signal]);
  const key = { sessionId, id: step.id };
  const stop = () => {
    controller.abort();
    throw signal.reason;
  };
  const cancelled = client.watchCommand(key, signal).then(stop, stop);
  try { return await Promise.race([cancelled, run(signal, key)]); }
  finally { controller.abort(); }
}

export async function runDesignSelectionTask(input: DesignSelectionTask) {
  const { signal, client } = input;
  const sourceId = input.view().document.documentId;
  const sessionId = input.sessionId ?? crypto.randomUUID();
  const participants = new Map<string, ReturnType<typeof designParticipant>>();
  async function exchange() {
    await input.synchronize(signal);
    signal.throwIfAborted();
    if (input.view().document.documentId !== sourceId) throw new Error('Design document changed.');
    let step = await client.start({ sessionId, clientId: input.clientId, ref: input.ref, documentId: sourceId, selection: [...input.selection], threadId: input.threadId }, signal);
    while (step.kind !== 'done') {
      signal.throwIfAborted();
      let result: DesignTaskResult;
      try {
        if (step.kind === 'ready') { input.onReady(); result = { content: '' }; }
        else if (step.kind === 'agentDone') {
          participants.delete(step.agent.turnId);
          input.view().showFocus?.(undefined, false, step.agent);
          result = { content: '' };
        } else {
          const key = step.agent?.turnId ?? '';
          let participant = participants.get(key);
          if (!participant || (step.kind === 'tool' && !step.agent && step.selection !== undefined)) {
            participant = designParticipant({ ...input, selection: step.kind === 'tool' ? step.selection ?? input.selection : input.selection }, sourceId, step.agent);
            participants.set(key, participant);
          }
          if (step.kind === 'applied') result = await participant.acknowledge(step);
          else {
            const command = step;
            const handler = participant;
            result = await runEditorCommand(client, sessionId, command, signal, (signal, key) => handler.process(command, signal, key));
          }
        }
      } catch (error) { result = { failed: true, content: error instanceof Error ? error.message : String(error) }; }
      signal.throwIfAborted();
      step = await client.reply({ sessionId, id: step.id, result }, signal);
    }
    await input.synchronize(signal);
  }
  signal.throwIfAborted();
  // Some desktop image/clipboard operations cannot be interrupted. Release the editor after
  // the runtime stops and let the old read finish without submitting another command.
  let cancel!: () => void;
  const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(signal.reason); });
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await Promise.race([exchange(), cancelled]);
  } catch (error) {
    await client.stop(sessionId).catch(() => null);
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
