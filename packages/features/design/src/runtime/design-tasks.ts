import type { RuntimeEditorSelection } from '@setsuna-desktop/contracts';
import type { DesignCommandKey } from '../contracts/design-command-key.js';
import { randomUUID } from 'node:crypto';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { designTaskRecord, readDesignSelection, type DesignAgent, type DesignInputBinding, type DesignToolPolicy, type DesignTaskReply, type DesignTaskResult, type DesignTaskStart, type DesignTaskStep,
  type DesignToolName, type DesignToolService, type DesignTurnHost } from '../contracts/design-task.js';
import type { DesignDocumentService } from './design-document-service.js';
import { designToolDefinitions } from './design-tool-definitions.js';
import { checkDesignTaskEdits } from './design-task-scope.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Participant = { selection: string[]; roots: Set<string>; reset: boolean; agent?: DesignAgent };
function participant(selection: string[], reset: boolean, agent?: DesignAgent): Participant {
  return { selection, roots: new Set(selection), reset, agent };
}

type Session = {
  start: DesignTaskStart;
  controller: AbortController;
  main: Participant;
  inputs: Map<string, string[]>;
  workspaceRoot?: string;
  next: ReturnType<typeof deferred<DesignTaskStep>>;
  pending?: { id: string; signal: AbortSignal; reply: ReturnType<typeof deferred<DesignTaskResult>> };
  lease?: ReturnType<typeof setTimeout>;
  ready?: Promise<DesignTaskResult>;
  closing?: Promise<void>;
  queue: Promise<void>;
  saving?: ReturnType<DesignDocumentService['commit']>;
};

/** A request stays with the agent until it yields one command or finishes. Only the originating
 * editor holds the session key. Plans come back to the runtime for a revision-checked commit. */
export class DesignTasks implements DesignToolService {
  readonly definitions = designToolDefinitions;
  private readonly sessions = new Map<string, Session>();
  private readonly threads = new Map<string, Session>();
  private readonly workers = new Map<string, { session: Session; agent: DesignAgent; participant: Participant; controller: AbortController }>();

  constructor(private readonly host: Pick<DesignTurnHost, 'resolveOwnedRoot' | 'cancel'>, private readonly documents: Pick<DesignDocumentService, 'read' | 'commit'>) {}

  join(parentThreadId: string, agent: DesignAgent) {
    const session = this.threads.get(parentThreadId);
    if (!session?.workspaceRoot || session.controller.signal.aborted || this.workers.has(agent.threadId)) throw new Error('Design editor unavailable for this agent.');
    this.workers.set(agent.threadId, { session, agent, participant: participant(session.main.selection, true, agent), controller: new AbortController() });
  }

  async leave(threadId: string, turnId: string) {
    const worker = this.workers.get(threadId);
    if (!worker || worker.agent.turnId !== turnId) return;
    worker.controller.abort();
    this.workers.delete(threadId);
    const { session, agent } = worker;
    await this.enqueue(session, async () => {
      if (!session.controller.signal.aborted) await this.request(session, { kind: 'agentDone', agent, id: randomUUID() }, session.controller.signal);
    });
  }

  private worker(threadId: string, turnId?: string) {
    const worker = this.workers.get(threadId);
    return worker && worker.agent.turnId === turnId ? worker : undefined;
  }

  // Resolve by the input actually sampled. Queue edits, reordering and failed submissions cannot retarget an earlier turn.
  private mainParticipant(session: Session, clientId?: string) {
    const selection = clientId ? session.inputs.get(clientId) : undefined;
    if (clientId && selection) {
      session.inputs.delete(clientId);
      session.main = participant(selection, true);
    }
    return session.main;
  }

  scope(threadId: string, turnId?: string, inputClientId?: string): ReturnType<DesignToolService['scope']> {
    const worker = this.worker(threadId, turnId);
    const session = worker?.session ?? this.threads.get(threadId);
    if (!session?.workspaceRoot || session.controller.signal.aborted) return;
    const bound = worker?.participant ?? this.mainParticipant(session, inputClientId);
    return { kind: bound.selection.length ? 'selection' : 'document', root: session.workspaceRoot, path: session.start.ref.path };
  }

  async start(input: DesignTaskStart, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.sessions.has(input.sessionId)) throw new Error('Design task already started.');
    const session: Session = { start: input, main: participant(input.selection, false), inputs: new Map(), queue: Promise.resolve(), controller: new AbortController(), next: deferred() };
    this.sessions.set(input.sessionId, session);
    const run = async () => {
      const { signal } = session.controller;
      const { document } = await this.documents.read(input.ref, signal);
      if (document.documentId !== input.documentId || input.selection.some((id) => !Object.hasOwn(document.nodes, id))) throw new Error('Design selection changed.');
      signal.throwIfAborted();
      session.workspaceRoot = await this.host.resolveOwnedRoot(input.threadId, input);
      if (!session.workspaceRoot) throw new Error('This chat belongs to another design document.');
      session.controller.signal.throwIfAborted();
      signal.throwIfAborted();
      if (this.threads.has(input.threadId)) throw new Error('This design chat is already bound to an editor.');
      this.threads.set(input.threadId, session);
      // The ordinary chat endpoint starts the turn after the editor has acknowledged this binding.
      session.ready = this.request(session, { kind: 'ready', id: randomUUID() }, signal);
      await session.ready;
    };
    void run().catch((error: unknown) => { session.next.reject(taskError(error)); void this.close(session); });
    return this.wait(session, signal);
  }

  reply({ sessionId, id, result }: DesignTaskReply, signal: AbortSignal) {
    signal.throwIfAborted();
    const session = this.sessions.get(sessionId);
    if (!session?.pending || session.controller.signal.aborted || session.pending.id !== id) throw new Error('The design command is no longer active.');
    clearTimeout(session.lease);
    const { reply } = session.pending;
    session.next = deferred();
    session.pending = undefined;
    reply.resolve(result);
    return this.wait(session, signal);
  }

  private async wait(session: Session, signal: AbortSignal) {
    const cancel = () => { void this.close(session); };
    signal.addEventListener('abort', cancel, { once: true });
    try { return await session.next.promise; }
    finally { signal.removeEventListener('abort', cancel); }
  }

  // One editor request/acknowledgement at a time. Independent agents continue sampling in parallel.
  private enqueue<T>(session: Session, operation: () => Promise<T>): Promise<T> {
    const result = session.queue.then(operation);
    session.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async bindInput({ sessionId, clientId, selection }: DesignInputBinding): Promise<null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.controller.signal.aborted) throw new Error('The design editor is unavailable.');
    session.inputs.set(clientId, selection);
    return null;
  }

  captureSelection(threadId: string, clientId: string) {
    const session = this.threads.get(threadId);
    if (!session || session.controller.signal.aborted) return;
    const ids = session.inputs.get(clientId) ?? (session.start.clientId === clientId ? session.start.selection : undefined);
    return ids && { documentId: session.start.documentId, ids: [...ids] };
  }

  restoreSelection(threadId: string, clientId: string, selection: RuntimeEditorSelection) {
    const session = this.threads.get(threadId);
    if (!session || session.controller.signal.aborted || session.start.documentId !== selection.documentId) throw new Error('The design editor is unavailable.');
    session.inputs.set(clientId, [...selection.ids]);
  }

  fileOperationSignal(command: DesignCommandKey | undefined, signal: AbortSignal) {
    if (!command) return signal;
    const pending = this.sessions.get(command.sessionId)?.pending;
    if (!pending || pending.id !== command.id) {
      throw new FeatureOperationFailure({ code: 'OPERATION_CANCELLED', message: 'Design command cancelled.', retryable: false });
    }
    const active = AbortSignal.any([pending.signal, signal]);
    active.throwIfAborted();
    return active;
  }

  async watchCommand({ sessionId, id }: DesignCommandKey, signal: AbortSignal) {
    const pending = this.sessions.get(sessionId)?.pending;
    if (pending?.id !== id || pending.signal.aborted) return null;
    const until = AbortSignal.any([pending.signal, signal]);
    if (!until.aborted) await new Promise<void>((resolve) => until.addEventListener('abort', () => resolve(), { once: true }));
    return null;
  }

  async execute(threadId: string, name: DesignToolName, input: unknown, turnSignal: AbortSignal, turnId?: string, policy?: DesignToolPolicy) {
    const worker = this.worker(threadId, turnId);
    const session = worker?.session ?? this.threads.get(threadId);
    if (!session) throw new Error('The design editor is unavailable.');
    return this.enqueue(session, async () => {
      turnSignal.throwIfAborted();
      session.controller.signal.throwIfAborted();
      if (worker && this.workers.get(threadId) !== worker) throw new Error('The design agent has finished.');
      await session.ready;
      const bound = worker?.participant ?? this.mainParticipant(session, policy?.inputClientId);
      const commandSignal = worker ? AbortSignal.any([turnSignal, worker.controller.signal]) : turnSignal;
      return this.executeBound(session, bound, name, input, commandSignal, policy?.networkAccess === true);
    });
  }

  private async executeBound(session: Session, bound: Participant, name: DesignToolName, input: unknown, turnSignal: AbortSignal, networkAccess: boolean) {
    const { agent, roots } = bound;
    const signal = AbortSignal.any([session.controller.signal, turnSignal]);
    signal.throwIfAborted();
    const args = designTaskRecord(input);
    const selection = name === 'design_view' && args.action === 'select' && args.ids !== undefined ? readDesignSelection(args.ids) : undefined;
    if (name === 'design_edit' && args.dryRun !== undefined && typeof args.dryRun !== 'boolean') throw new Error('dryRun must be a boolean.');
    if (bound.reset && bound.selection.length) {
      const { document } = await this.documents.read(session.start.ref, signal);
      if (bound.selection.some((id) => !Object.hasOwn(document.nodes, id))) throw new Error('A referenced design layer is no longer available.');
      signal.throwIfAborted();
    }
    const id = randomUUID();
    const result = await this.request(session, { kind: 'tool', id, name, args, agent, networkAccess, selection: bound.reset ? bound.selection : undefined },
      agent ? session.controller.signal : signal, signal);
    bound.reset = false;
    signal.throwIfAborted();
    if (result.failed) throw new Error(result.content);
    // Only an acknowledged select command can retarget future writes. Use its full request,
    // since the display receipt can abbreviate large selections.
    if (selection && !result.plan) { roots.clear(); for (const id of selection) roots.add(id); }
    let content = result.content;
    if (result.plan) {
      if (name !== 'design_edit' || result.plan.revision !== args.revision) throw new Error('Unexpected design mutation.');
      const { revision, edits } = result.plan;
      const summary = designTaskRecord(JSON.parse(content || '{}'));
      let savedRevision = revision;
      const dryRun = args.dryRun === true;
      let refresh: Record<string, unknown> = {};
      if (edits.length || dryRun) {
        let extended: ReadonlySet<string> | undefined;
        session.saving = this.documents.commit({ ref: session.start.ref, expectedRevision: revision, edits }, signal, (document) => {
          if (document.documentId !== session.start.documentId) throw new Error('Design document changed.');
          // Validate the resolved plan, including nested inserts, paste and duplication.
          if (!networkAccess && !dryRun && edits.some((edit) => {
            if (edit.kind !== 'insert' && edit.kind !== 'update') return false;
            if (edit.node.kind !== 'web' || !edit.node.url) return false;
            const previous = document.nodes[edit.nodeId];
            return edit.kind === 'insert' || previous?.kind !== 'web' || previous.url !== edit.node.url;
          })) throw new Error('Network access is required to add or change a web layer URL.');
          if (bound.selection.length) extended = checkDesignTaskEdits(document, edits, roots, args);
        }, dryRun);
        try {
          savedRevision = (await session.saving).revision;
          if (!dryRun) extended?.forEach((id) => roots.add(id));
        } catch (error) {
          if (error instanceof FeatureOperationFailure && error.code === 'REVISION_CONFLICT') {
            throw new Error(JSON.stringify({ applied: false, error: error.message, code: error.code }));
          }
          throw error;
        } finally { session.saving = undefined; }
        if (!dryRun) {
          // The save already succeeded. A lost canvas acknowledgement must not invite a duplicate write.
          try {
            const ack = await this.request(session, { kind: 'applied', revision: savedRevision, agent, id: randomUUID() }, session.controller.signal);
            refresh = ack.failed ? { refreshed: false } : designTaskRecord(JSON.parse(ack.content || '{}'));
          } catch { refresh = { refreshed: false }; }
        }
      }
      content = JSON.stringify({ revision: savedRevision, applied: savedRevision !== revision, ids: dryRun ? [] : summary.ids,
        count: summary.count, changes: summary.changes, validated: dryRun || undefined, layout: dryRun ? summary.layout : undefined, refreshed: refresh.refreshed,
        insertedCount: refresh.insertedCount, inserted: refresh.inserted });
    }
    const image = name === 'design_preview' ? result.image : undefined;
    return { content, containsExternalContext: true as const,
      ...(image ? { attachments: [{ id, name: 'selection.png', type: 'image/png', url: image,
        size: Buffer.from(image.slice('data:image/png;base64,'.length), 'base64').length }] } : {}) };
  }

  private async request(session: Session, step: Exclude<DesignTaskStep, { kind: 'done' }>, signal: AbortSignal, commandSignal = signal): Promise<DesignTaskResult> {
    signal.throwIfAborted();
    if (session.pending) throw new Error('Another design command is pending.');
    const reply = deferred<DesignTaskResult>();
    const finished = new AbortController();
    session.pending = { id: step.id, reply, signal: AbortSignal.any([commandSignal, finished.signal]) };
    const cancel = () => { void this.close(session); };
    signal.addEventListener('abort', cancel, { once: true });
    // A window may disappear between receiving its command and returning its plan.
    session.lease = setTimeout(cancel, 5 * 60_000);
    try {
      session.next.resolve(step);
      return await reply.promise;
    } finally {
      finished.abort();
      clearTimeout(session.lease);
      signal.removeEventListener('abort', cancel);
    }
  }

  async stop(id: string): Promise<null> {
    const session = this.sessions.get(id);
    if (session) await this.close(session);
    return null;
  }

  private close(session: Session) {
    // Disconnect and the explicit handoff request can arrive together. Both must drain the same save.
    return session.closing ??= Promise.resolve().then(() => this.finish(session));
  }

  private async finish(session: Session) {
    if (this.sessions.get(session.start.sessionId) !== session) return;
    clearTimeout(session.lease);
    if (!session.controller.signal.aborted) {
      session.controller.abort();
      const reason = new Error('The editor ended the design task.');
      session.pending?.reply.reject(reason);
      session.next.resolve({ kind: 'done' });
    }
    const children = [...this.workers.values()].filter((worker) => worker.session === session);
    for (const { agent } of children) this.workers.delete(agent.threadId);
    await Promise.all(children.map(({ agent }) => this.host.cancel(agent.threadId, agent.turnId).catch(() => undefined)));
    if (this.threads.get(session.start.threadId) === session) {
      await this.host.cancel(session.start.threadId).catch(() => undefined);
      if (this.threads.get(session.start.threadId) === session) this.threads.delete(session.start.threadId);
    }
    await session.saving?.catch(() => undefined);
    if (this.sessions.get(session.start.sessionId) === session) this.sessions.delete(session.start.sessionId);
  }

  async dispose() { await Promise.all([...this.sessions.keys()].map((id) => this.stop(id))); }
}

function taskError(error: unknown) {
  return new FeatureOperationFailure({ code: 'INVALID_INPUT', message: error instanceof Error ? error.message : String(error), retryable: false });
}
