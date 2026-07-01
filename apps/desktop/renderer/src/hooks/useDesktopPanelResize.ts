import { useCallback, useEffect, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from 'react';

type CssVariableName = string | readonly string[];

const SIDEBAR_WIDTH_VARIABLES = ['--app-sidebar-width', '--app-topbar-sidebar-width'] as const;
const SIDEBAR_MIN_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 360;
const WORKBENCH_MAIN_MIN_WIDTH = 420;
const WORKSPACE_MIN_WIDTH = 460;
const WORKSPACE_MAX_WIDTH = 860;
const TERMINAL_MIN_HEIGHT = 180;
const TERMINAL_MAX_HEIGHT = 520;

export function useDesktopPanelResize(shellRef: RefObject<HTMLDivElement | null>) {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [workspaceWidth, setWorkspaceWidth] = useState(560);
  const [terminalHeight, setTerminalHeight] = useState(260);
  const setShellVariables = useCallback(
    (names: CssVariableName, value: string) => {
      const shell = shellRef.current;
      if (!shell) return;
      const variableNames = Array.isArray(names) ? names : [names];
      variableNames.forEach((name) => shell.style.setProperty(name, value));
    },
    [shellRef],
  );
  const stepResizeValue = useCallback(
    (cssVariables: CssVariableName, clamp: (value: number) => number, setValue: Dispatch<SetStateAction<number>>, delta: number) => {
      setValue((current) => {
        const nextValue = clamp(current + delta);
        setShellVariables(cssVariables, `${nextValue}px`);
        return nextValue;
      });
    },
    [setShellVariables],
  );

  const handleSidebarResizeStart = usePointerResize({
    bodyClassName: 'desktop-agent-sidebar-resizing',
    clamp: clampSidebarWidth,
    cssVariables: SIDEBAR_WIDTH_VARIABLES,
    direction: 1,
    getPointerPosition: (event) => event.clientX,
    setShellVariables,
    setValue: setSidebarWidth,
    value: sidebarWidth,
  });

  const clampWorkspaceWidth = useCallback(
    (value: number) =>
      clampWorkspaceWidthForLayout(value, {
        sidebarWidth: readShellPixelVariable(shellRef.current, '--app-sidebar-width', sidebarWidth),
        viewportWidth: shellRef.current?.clientWidth ?? viewportWidth(),
      }),
    [shellRef, sidebarWidth],
  );

  const handleWorkspaceResizeStart = usePointerResize({
    bodyClassName: 'desktop-agent-workspace-resizing',
    clamp: clampWorkspaceWidth,
    cssVariables: '--desktop-agent-workspace-width',
    direction: -1,
    getPointerPosition: (event) => event.clientX,
    setShellVariables,
    setValue: setWorkspaceWidth,
    value: workspaceWidth,
  });

  const handleTerminalResizeStart = usePointerResize({
    bodyClassName: 'desktop-terminal-resizing',
    clamp: clampTerminalHeight,
    cssVariables: '--app-bottom-panel-height',
    direction: -1,
    getPointerPosition: (event) => event.clientY,
    setShellVariables,
    setValue: setTerminalHeight,
    value: terminalHeight,
  });
  const handleSidebarResizeStep = useCallback(
    (delta: number) => stepResizeValue(SIDEBAR_WIDTH_VARIABLES, clampSidebarWidth, setSidebarWidth, delta),
    [stepResizeValue],
  );
  const handleWorkspaceResizeStep = useCallback(
    (delta: number) => stepResizeValue('--desktop-agent-workspace-width', clampWorkspaceWidth, setWorkspaceWidth, delta),
    [clampWorkspaceWidth, stepResizeValue],
  );
  const handleTerminalResizeStep = useCallback(
    (delta: number) => stepResizeValue('--app-bottom-panel-height', clampTerminalHeight, setTerminalHeight, delta),
    [stepResizeValue],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let frame = 0;
    const syncResponsiveBounds = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setWorkspaceWidth((current) => {
          const nextValue = clampWorkspaceWidth(current);
          if (nextValue === current) return current;
          setShellVariables('--desktop-agent-workspace-width', `${nextValue}px`);
          return nextValue;
        });
      });
    };
    window.addEventListener('resize', syncResponsiveBounds);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', syncResponsiveBounds);
    };
  }, [clampWorkspaceWidth, setShellVariables]);

  return {
    handleSidebarResizeStep,
    handleSidebarResizeStart,
    handleTerminalResizeStep,
    handleTerminalResizeStart,
    handleWorkspaceResizeStep,
    handleWorkspaceResizeStart,
    sidebarMaxWidth: SIDEBAR_MAX_WIDTH,
    sidebarMinWidth: SIDEBAR_MIN_WIDTH,
    sidebarWidth,
    terminalMaxHeight: TERMINAL_MAX_HEIGHT,
    terminalHeight,
    terminalMinHeight: TERMINAL_MIN_HEIGHT,
    workspaceMaxWidth: WORKSPACE_MAX_WIDTH,
    workspaceMinWidth: WORKSPACE_MIN_WIDTH,
    workspaceWidth,
  };
}

function usePointerResize({
  bodyClassName,
  clamp,
  cssVariables,
  direction,
  getPointerPosition,
  setShellVariables,
  setValue,
  value,
}: {
  bodyClassName: string;
  clamp: (value: number) => number;
  cssVariables: CssVariableName;
  direction: 1 | -1;
  getPointerPosition: (event: PointerEvent | ReactPointerEvent<HTMLButtonElement>) => number;
  setShellVariables: (names: CssVariableName, value: string) => void;
  setValue: Dispatch<SetStateAction<number>>;
  value: number;
}) {
  return useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const startPosition = getPointerPosition(event);
      const startValue = value;
      let animationFrame = 0;
      let nextValue = startValue;

      const applyResizeFrame = () => setShellVariables(cssVariables, `${nextValue}px`);
      const handlePointerMove = (moveEvent: PointerEvent) => {
        nextValue = clamp(startValue + (getPointerPosition(moveEvent) - startPosition) * direction);
        if (animationFrame) return;
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = 0;
          applyResizeFrame();
        });
      };
      const handlePointerEnd = () => {
        if (animationFrame) {
          window.cancelAnimationFrame(animationFrame);
          animationFrame = 0;
          applyResizeFrame();
        }
        setValue(nextValue);
        document.body.classList.remove(bodyClassName);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerEnd);
        window.removeEventListener('pointercancel', handlePointerEnd);
      };

      document.body.classList.add(bodyClassName);
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerEnd);
      window.addEventListener('pointercancel', handlePointerEnd);
    },
    [bodyClassName, clamp, cssVariables, direction, getPointerPosition, setShellVariables, setValue, value],
  );
}

function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

export function clampWorkspaceWidthForLayout(
  value: number,
  {
    sidebarWidth,
    viewportWidth: availableViewportWidth,
  }: {
    sidebarWidth: number;
    viewportWidth: number;
  },
): number {
  const layoutMaxWidth = availableViewportWidth - sidebarWidth - WORKBENCH_MAIN_MIN_WIDTH;
  const maxWidth = Math.max(WORKSPACE_MIN_WIDTH, Math.min(WORKSPACE_MAX_WIDTH, Math.floor(layoutMaxWidth)));
  return Math.min(maxWidth, Math.max(WORKSPACE_MIN_WIDTH, Math.round(value)));
}

function clampTerminalHeight(value: number): number {
  const maxHeight = typeof window === 'undefined' ? TERMINAL_MAX_HEIGHT : Math.max(220, Math.min(TERMINAL_MAX_HEIGHT, window.innerHeight - 260));
  return Math.min(maxHeight, Math.max(TERMINAL_MIN_HEIGHT, Math.round(value)));
}

function readShellPixelVariable(shell: HTMLElement | null, name: string, fallback: number): number {
  if (!shell || typeof window === 'undefined') return fallback;
  const value = Number.parseFloat(window.getComputedStyle(shell).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? WORKSPACE_MAX_WIDTH + SIDEBAR_MAX_WIDTH + WORKBENCH_MAIN_MIN_WIDTH : window.innerWidth;
}
