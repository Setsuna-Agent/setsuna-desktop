import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

type MarkdownViewportRef = RefObject<HTMLDivElement | null>;
type MarkdownViewportContextValue = {
  observe: (element: Element, onIntersectionChange: (intersects: boolean) => void) => (() => void) | null;
  supported: boolean;
};

const markdownVirtualizationOverscanPx = 1_200;
const MarkdownViewportContext = createContext<MarkdownViewportContextValue | null>(null);

export function MarkdownViewportProvider({
  children,
  scrollRef,
}: {
  children: ReactNode;
  scrollRef: MarkdownViewportRef;
}) {
  const callbacksRef = useRef(new Map<Element, (intersects: boolean) => void>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const supported = typeof window !== 'undefined' && typeof IntersectionObserver !== 'undefined';
  const observe = useCallback<MarkdownViewportContextValue['observe']>((element, onIntersectionChange) => {
    const viewport = scrollRef.current;
    if (!viewport || !supported) return null;

    if (!observerRef.current) {
      // 共用一个观察器，避免长回答为每个 Markdown 块分别分配观察器。
      observerRef.current = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          callbacksRef.current.get(entry.target)?.(entry.isIntersecting);
        }
      }, {
        root: viewport,
        rootMargin: `${markdownVirtualizationOverscanPx}px 0px`,
      });
    }

    callbacksRef.current.set(element, onIntersectionChange);
    observerRef.current.observe(element);
    return () => {
      callbacksRef.current.delete(element);
      observerRef.current?.unobserve(element);
    };
  }, [scrollRef, supported]);
  const value = useMemo<MarkdownViewportContextValue>(() => ({ observe, supported }), [observe, supported]);

  useEffect(() => () => {
    callbacksRef.current.clear();
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  return (
    <MarkdownViewportContext.Provider value={value}>
      {children}
    </MarkdownViewportContext.Provider>
  );
}

export function useMarkdownViewport(): MarkdownViewportContextValue | null {
  return useContext(MarkdownViewportContext);
}
