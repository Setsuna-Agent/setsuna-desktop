import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignAgent } from '../../contracts/design-task.js';
import type { DesignAgentFocus } from './design-agent-focus.js';

const deletionFocusMs = 650;

export function useDesignAgentActivity() {
  const [running, setActive] = useState(false);
  const [focus, setFocus] = useState<DesignAgentFocus>();
  const visible = useRef(new Map<string, DesignAgentFocus>());
  const holds = useRef(new Map<string, { timer: number; next?: DesignAgentFocus }>());

  const publish = useCallback((id: string, next?: DesignAgentFocus) => {
    if (next) visible.current.set(id, next);
    else visible.current.delete(id);
    setFocus(visible.current.size ? [...visible.current.values()].flat() : undefined);
  }, []);

  const showFocus = useCallback((next: DesignAgentFocus | undefined, deleted = false, agent?: DesignAgent) => {
    const id = agent?.turnId ?? '';
    const targets = agent ? next?.map((target) => ({ ...target, agent })) : next;
    const hold = holds.current.get(id);
    if (!deleted && hold && targets) {
      hold.next = targets;
      return;
    }
    window.clearTimeout(hold?.timer);
    holds.current.delete(id);
    publish(id, targets);
    if (!deleted || !targets) return;
    // Retain a deletion briefly, independently of other agents moving or finishing.
    const timer = window.setTimeout(() => {
      const latest = holds.current.get(id)?.next;
      holds.current.delete(id);
      publish(id, latest);
    }, deletionFocusMs);
    holds.current.set(id, { timer });
  }, [publish]);

  const reset = useCallback(() => {
    for (const hold of holds.current.values()) window.clearTimeout(hold.timer);
    holds.current.clear();
    visible.current.clear();
  }, []);
  const setRunning = useCallback((active: boolean) => {
    reset();
    setFocus(undefined);
    setActive(active);
  }, [reset]);

  useEffect(() => reset, [reset]);
  return { running, focus, setRunning, showFocus };
}
