import {
  createContext, useCallback, useContext, useLayoutEffect, useRef, useState,
  type Dispatch, type PropsWithChildren, type RefObject, type SetStateAction,
} from 'react';

type PageSession = { values: Map<string, unknown>; scroll: Map<string, number> };
const PageSessionContext = createContext<PageSession | null>(null);
const createSession = (): PageSession => ({ values: new Map(), scroll: new Map() });

/** Retain lightweight navigation state for this window, without keeping inactive views mounted. */
export function PageSessionProvider({ children }: PropsWithChildren) {
  const [session] = useState(createSession);
  return <PageSessionContext.Provider value={session}>{children}</PageSessionContext.Provider>;
}

function usePageSession() {
  const shared = useContext(PageSessionContext);
  const [local] = useState(createSession);
  return shared ?? local;
}

/** The key identifies one mounted page owner; remount that owner when its identity changes. */
export function usePageSessionState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const session = usePageSession();
  const [state, setState] = useState<T>(() => session.values.has(key)
    ? session.values.get(key) as T
    : typeof initial === 'function' ? (initial as () => T)() : initial);
  const latest = useRef(state);
  const update = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const value = typeof next === 'function' ? (next as (current: T) => T)(latest.current) : next;
    latest.current = value;
    session.values.set(key, value);
    setState(value);
  }, [key, session]);
  return [state, update];
}

/** Save on scroll, not unmount: a replacement view can already have changed the same viewport. */
export function usePageScrollRestoration(key: string, root: RefObject<HTMLElement | null>, options?: {
  closest?: string;
  delegateTo?: string;
}) {
  const session = usePageSession();
  const closest = options?.closest;
  const delegateTo = options?.delegateTo;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || (delegateTo && element.querySelector(delegateTo))) return;
    const viewport = closest ? element.closest<HTMLElement>(closest) : element;
    if (!viewport) return;
    viewport.scrollTop = session.scroll.get(key) ?? 0;
    const remember = () => { session.scroll.set(key, viewport.scrollTop); };
    viewport.addEventListener('scroll', remember, { passive: true });
    return () => { viewport.removeEventListener('scroll', remember); };
  }, [closest, delegateTo, key, root, session]);
}
