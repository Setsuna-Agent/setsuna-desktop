import { useCallback, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useConfirm, useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignSelectionReference } from '../../contracts/design-selection-mention.js';
import type { DesignConversationOwner, DesignSnapshot } from '../../contracts/index.js';
import type { DesignTaskClient } from '../../contracts/design-task.js';
import { DesignChatPanelContext } from './design-chat-layout.js';
import './design-chat.css';
import type { DesignTaskView } from './design-selection-task.js';

export type DesignCanvasSelection = {
  subscribePicks(begin: (additive?: boolean) => ((reference: DesignSelectionReference | null) => void) | undefined): () => void;
  reveal(reference: DesignSelectionReference): void;
};
export type DesignChatBinding = DesignConversationOwner & Partial<DesignCanvasSelection> & {
  bind(threadId: string, ids?: readonly string[], clientId?: string): Promise<void>;
  release(): Promise<void>;
  onBusyChange?(busy: boolean): void;
};
export type RenderDesignChat = (binding: DesignChatBinding, projectId?: string | null) => ReactNode;

export function DesignChatBridge(props: {
  client: DesignTaskClient; owner: DesignConversationOwner; selection: readonly string[]; disabled: boolean;
  subscribePicks?: DesignChatBinding['subscribePicks']; reveal?: DesignChatBinding['reveal'];
  view: DesignTaskView; synchronize(signal: AbortSignal): Promise<DesignSnapshot>;
  onRunning(running: boolean): void; renderChat?: RenderDesignChat; canvasRequest?: { threadId: string; id: string };
}) {
  const panel = useContext(DesignChatPanelContext);
  const confirm = useConfirm();
  const toast = useToast();
  const latest = useRef(props);
  const mounted = useRef(false);
  const session = useRef<{ sessionId: string; threadId: string; controller: AbortController; ready: Promise<void>; finished: Promise<void> }>();
  useLayoutEffect(() => { latest.current = props; });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; session.current?.controller.abort(); };
  }, []);

  const release = useCallback(async () => {
    const active = session.current;
    active?.controller.abort();
    await active?.finished;
  }, []);
  const bind = useCallback(async (threadId: string, requested: readonly string[], clientId?: string,
    canvasRequestId?: string, signal?: AbortSignal) => {
    const previous = session.current;
    if (previous?.controller.signal.aborted) await previous.finished;
    signal?.throwIfAborted();
    const view = latest.current.view;
    if (requested.some((id) => !Object.hasOwn(view.document.nodes, id))) {
      throw new Error(view.editor?.translate('feature.design.selectionUnavailable') ?? 'The referenced layers are unavailable in this design.');
    }
    if (session.current?.threadId === threadId) {
      const active = session.current;
      await active.ready;
      if (clientId) await latest.current.client.bindInput({ sessionId: active.sessionId, clientId, selection: [...requested] }, active.controller.signal);
      return;
    }
    const { client, owner, disabled, synchronize, onRunning } = latest.current;
    if (!mounted.current || session.current || disabled) throw new Error('The design editor is busy.');
    const controller = new AbortController();
    const sessionId = crypto.randomUUID();
    let accept!: () => void;
    let reject!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, fail) => { accept = resolve; reject = fail; });
    let accepted = false;
    onRunning(true);
    const finished = import('./design-selection-task.js').then(({ runDesignSelectionTask }) =>
      runDesignSelectionTask({ sessionId, clientId, canvasRequestId, client, ref: owner.ref, threadId, selection: requested, signal: controller.signal,
        onReady: () => { accepted = true; accept(); }, synchronize, view: () => latest.current.view,
        approve: (tool, description, signal) => confirm({ title: tool, description }, signal) }))
      .then(() => {
        if (accepted) return;
        if (canvasRequestId) accept();
        else throw new Error('Design chat closed before binding.');
      })
      .catch((error: unknown) => {
        reject(error);
        if (accepted && mounted.current && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
      }).finally(async () => {
        if (mounted.current) await synchronize(new AbortController().signal).catch(() => undefined);
        if (session.current?.controller === controller) {
          session.current = undefined;
          if (mounted.current) onRunning(false);
        }
      });
    session.current = { sessionId, threadId, controller, ready, finished };
    return ready;
  }, [confirm, toast]);

  const requestId = props.canvasRequest?.id;
  const threadId = props.canvasRequest?.threadId;
  useEffect(() => {
    if (!requestId || !threadId) return;
    const controller = new AbortController();
    void bind(threadId, [], undefined, requestId, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    });
    return () => { controller.abort(); void release(); };
  }, [bind, release, requestId, threadId, toast]);

  // Capture the selection for the send gesture, even if creating its first thread takes time.
  return props.renderChat?.({ ...props.owner, bind: (id, ids, clientId) => bind(id, ids ?? props.selection, clientId), release, subscribePicks: panel.visible ? props.subscribePicks : undefined,
    reveal: props.reveal && ((reference) => { panel.showCanvas?.(); props.reveal?.(reference); }) }) ?? null;
}
