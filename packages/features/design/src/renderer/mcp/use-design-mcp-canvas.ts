import { useCallback, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import type { DesignMcpCanvasEvent } from '../../contracts/design-mcp.js';
import { designAgentFocus, type DesignAgentFocus } from '../agent/design-agent-focus.js';
import { DesignUiHostContext } from '../context/design-ui-host.js';
import type { DesignMcpCanvasView } from './read-design-canvas.js';

type Highlight = { requestId: string; focus: DesignAgentFocus; timer?: number };
const focusHoldMs = 2_800;

export function useDesignMcpCanvas(visible: boolean, view: Omit<DesignMcpCanvasView, 'revision'>) {
  const bridge = useContext(DesignUiHostContext)?.mcp;
  const canvasId = useId();
  const latest = useRef<DesignMcpCanvasView>();
  useLayoutEffect(() => {
    if (!visible || !bridge) {
      latest.current = undefined;
      return;
    }
    const previous = latest.current;
    const sameSnapshot = previous?.document === view.document && previous.projected === view.projected
      && previous.scene === view.scene && previous.resources === view.resources && previous.selection === view.selection && previous.name === view.name;
    // A cursor belongs to this visible projection and cannot be reused after reopening the draft.
    latest.current = { ...view, revision: sameSnapshot ? previous.revision : crypto.randomUUID() };
  }, [bridge, visible, view]);
  const [focus, setFocus] = useState<DesignAgentFocus>();
  const activate = useCallback(() => {
    if (visible) bridge?.setCanvas(canvasId, true);
  }, [bridge, canvasId, visible]);

  useLayoutEffect(() => {
    setFocus(undefined);
    if (!visible || !bridge) return;
    const reads = new Map<string, AbortController>();
    const highlights = new Map<string, Highlight>();
    const publish = () => setFocus(highlights.size ? [...highlights.values()].flatMap((value) => value.focus) : undefined);
    const clear = (agentId: string, requestId?: string) => {
      const entry = highlights.get(agentId);
      if (!entry || (requestId && entry.requestId !== requestId)) return;
      window.clearTimeout(entry.timer);
      highlights.delete(agentId);
      publish();
    };

    async function read({ agent, requestId, read }: Extract<DesignMcpCanvasEvent, { kind: 'read' }>) {
      const view = latest.current;
      if (!view) return;
      const controller = new AbortController();
      const { signal } = controller;
      reads.set(requestId, controller);
      try {
        const { readDesignMcpCanvas } = await import('./read-design-canvas.js');
        const value = await readDesignMcpCanvas(view, read, (ids) => {
          window.clearTimeout(highlights.get(agent.id)?.timer);
          const targets = designAgentFocus(view.document, view.scene, ids);
          const label = { name: agent.name, threadId: agent.id, turnId: agent.id, colorIndex: agent.id.charCodeAt(agent.id.length - 1) };
          if (targets) highlights.set(agent.id, { requestId, focus: targets.map((target) => ({ ...target, agent: label })) });
          else highlights.delete(agent.id);
          publish();
        }, signal);
        if (!signal.aborted) bridge?.reply(requestId, { ok: true, value });
      } catch (error) {
        if (!signal.aborted) bridge?.reply(requestId, { ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        reads.delete(requestId);
        const entry = highlights.get(agent.id);
        if (entry?.requestId === requestId) {
          entry.timer = window.setTimeout(() => clear(agent.id, requestId), focusHoldMs);
        }
      }
    }

    const unsubscribe = bridge.onRequest((request) => {
      if (request.canvasId !== canvasId) return;
      if (request.kind === 'read') void read(request);
      else {
        reads.get(request.requestId)?.abort();
        for (const agentId of highlights.keys()) clear(agentId, request.requestId);
      }
    });
    activate();
    return () => {
      bridge.setCanvas(canvasId, false);
      unsubscribe();
      for (const controller of reads.values()) controller.abort();
      for (const entry of highlights.values()) window.clearTimeout(entry.timer);
      highlights.clear();
    };
  }, [activate, bridge, canvasId, visible]);

  return { focus: visible ? focus : undefined, activate };
}
