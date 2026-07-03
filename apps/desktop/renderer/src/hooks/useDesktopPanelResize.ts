import { useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from 'react';

type CssVariableName = string | readonly string[];
type DesktopPanelResizeOptions = {
  bottomPanelVisible?: boolean;
  workspaceVisible?: boolean;
};

const SIDEBAR_WIDTH_VARIABLES = ['--app-sidebar-width', '--app-topbar-sidebar-width'] as const;
const SIDEBAR_MIN_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 360;
export const WORKBENCH_MAIN_MIN_WIDTH = 420;
export const WORKBENCH_EXPANDED_SIDEBAR_MAIN_MIN_WIDTH = 520;
const WORKBENCH_MAIN_MIN_HEIGHT = 260;
const WORKSPACE_MIN_WIDTH = 460;
const TERMINAL_MIN_HEIGHT = 180;
const TERMINAL_MAX_HEIGHT = 520;

export function useDesktopPanelResize(
  shellRef: RefObject<HTMLDivElement | null>,
  { bottomPanelVisible = true, workspaceVisible = true }: DesktopPanelResizeOptions = {},
) {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [workspaceWidth, setWorkspaceWidth] = useState(560);
  const [workspacePreviewWidth, setWorkspacePreviewWidth] = useState<number | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(260);
  const workspacePreviewCanFitSidebarRef = useRef<boolean | null>(null);
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

  const clampTerminalHeight = useCallback(
    (value: number) =>
      clampTerminalHeightForLayout(value, {
        workbenchHeight: readWorkbenchHeight(shellRef.current),
      }),
    [shellRef],
  );
  const canWorkspaceKeepSidebarExpanded = useCallback(
    (value: number) =>
      canWorkspaceWidthKeepExpandedSidebar({
        sidebarWidth,
        viewportWidth: shellRef.current?.clientWidth ?? viewportWidth(),
        workspaceWidth: value,
      }),
    [shellRef, sidebarWidth],
  );
  const beginWorkspacePreviewResize = useCallback(
    (value: number) => {
      workspacePreviewCanFitSidebarRef.current = canWorkspaceKeepSidebarExpanded(value);
      setWorkspacePreviewWidth(null);
    },
    [canWorkspaceKeepSidebarExpanded],
  );
  const updateWorkspacePreviewResize = useCallback(
    (value: number) => {
      const nextCanFitSidebar = canWorkspaceKeepSidebarExpanded(value);
      if (workspacePreviewCanFitSidebarRef.current === nextCanFitSidebar) return;
      workspacePreviewCanFitSidebarRef.current = nextCanFitSidebar;
      setWorkspacePreviewWidth(value);
    },
    [canWorkspaceKeepSidebarExpanded],
  );
  const endWorkspacePreviewResize = useCallback(() => {
    workspacePreviewCanFitSidebarRef.current = null;
    setWorkspacePreviewWidth(null);
  }, []);

  const handleWorkspaceResizeStart = usePointerResize({
    bodyClassName: 'desktop-agent-workspace-resizing',
    clamp: clampWorkspaceWidth,
    cssVariables: '--desktop-agent-workspace-width',
    direction: -1,
    getPointerPosition: (event) => event.clientX,
    onPreviewEnd: endWorkspacePreviewResize,
    onPreviewStart: beginWorkspacePreviewResize,
    onPreviewValue: updateWorkspacePreviewResize,
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
  const fitWorkspaceForExpandedSidebar = useCallback(() => {
    const maxExpandedWorkspaceWidth = workspaceMaxWidthForExpandedSidebar({
      sidebarWidth,
      viewportWidth: shellRef.current?.clientWidth ?? viewportWidth(),
    });
    workspacePreviewCanFitSidebarRef.current = null;
    setWorkspacePreviewWidth(null);
    setWorkspaceWidth((current) => {
      const nextValue = Math.min(current, maxExpandedWorkspaceWidth);
      setShellVariables('--desktop-agent-workspace-width', workspaceWidthCssValue(nextValue, workspaceVisible));
      if (nextValue === current) return current;
      return nextValue;
    });
  }, [setShellVariables, shellRef, sidebarWidth, workspaceVisible]);
  const handleTerminalResizeStep = useCallback(
    (delta: number) => stepResizeValue('--app-bottom-panel-height', clampTerminalHeight, setTerminalHeight, delta),
    [clampTerminalHeight, stepResizeValue],
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
          setShellVariables('--desktop-agent-workspace-width', workspaceWidthCssValue(nextValue, workspaceVisible));
          if (nextValue === current) return current;
          return nextValue;
        });
        setTerminalHeight((current) => {
          const nextValue = clampTerminalHeight(current);
          setShellVariables('--app-bottom-panel-height', terminalHeightCssValue(nextValue, bottomPanelVisible));
          if (nextValue === current) return current;
          return nextValue;
        });
      });
    };
    syncResponsiveBounds();
    window.addEventListener('resize', syncResponsiveBounds);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', syncResponsiveBounds);
    };
  }, [bottomPanelVisible, clampTerminalHeight, clampWorkspaceWidth, setShellVariables, workspaceVisible]);

  const terminalMaxHeight = clampTerminalHeight(TERMINAL_MAX_HEIGHT);
  const workspaceMaxWidth = clampWorkspaceWidth(Number.POSITIVE_INFINITY);
  const workspaceLayoutWidth = workspacePreviewWidth ?? workspaceWidth;

  return {
    handleSidebarResizeStep,
    handleSidebarResizeStart,
    handleTerminalResizeStep,
    handleTerminalResizeStart,
    handleWorkspaceResizeStep,
    handleWorkspaceResizeStart,
    fitWorkspaceForExpandedSidebar,
    sidebarMaxWidth: SIDEBAR_MAX_WIDTH,
    sidebarMinWidth: SIDEBAR_MIN_WIDTH,
    sidebarWidth,
    terminalMaxHeight,
    terminalHeight,
    terminalMinHeight: TERMINAL_MIN_HEIGHT,
    workspaceMaxWidth,
    workspaceMinWidth: WORKSPACE_MIN_WIDTH,
    workspaceLayoutWidth,
    workspaceWidth,
  };
}

function usePointerResize({
  bodyClassName,
  clamp,
  cssVariables,
  direction,
  getPointerPosition,
  onPreviewEnd,
  onPreviewStart,
  onPreviewValue,
  setShellVariables,
  setValue,
  value,
}: {
  bodyClassName: string;
  clamp: (value: number) => number;
  cssVariables: CssVariableName;
  direction: 1 | -1;
  getPointerPosition: (event: PointerEvent | ReactPointerEvent<HTMLButtonElement>) => number;
  onPreviewEnd?: (value: number) => void;
  onPreviewStart?: (value: number) => void;
  onPreviewValue?: (value: number) => void;
  setShellVariables: (names: CssVariableName, value: string) => void;
  setValue: Dispatch<SetStateAction<number>>;
  value: number;
}) {
  return useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const pointerScale = pageScaleInverse();
      const scaledPointerPosition = (pointerEvent: PointerEvent | ReactPointerEvent<HTMLButtonElement>) =>
        getPointerPosition(pointerEvent) * pointerScale;
      const resizeHandle = event.currentTarget;
      const pointerId = event.pointerId;
      const startPosition = scaledPointerPosition(event);
      const startValue = value;
      let animationFrame = 0;
      let nextValue = startValue;

      onPreviewStart?.(startValue);
      const applyResizeFrame = () => {
        setShellVariables(cssVariables, `${nextValue}px`);
        onPreviewValue?.(nextValue);
      };
      const handlePointerMove = (moveEvent: PointerEvent) => {
        nextValue = clamp(startValue + (scaledPointerPosition(moveEvent) - startPosition) * direction);
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
        if (resizeHandle.hasPointerCapture?.(pointerId)) {
          resizeHandle.releasePointerCapture?.(pointerId);
        }
        setValue(nextValue);
        onPreviewEnd?.(nextValue);
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
    [bodyClassName, clamp, cssVariables, direction, getPointerPosition, onPreviewEnd, onPreviewStart, onPreviewValue, setShellVariables, setValue, value],
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
  const maxWidth = workspaceMaxWidthForLayout({ sidebarWidth, viewportWidth: availableViewportWidth });
  return Math.min(maxWidth, Math.max(WORKSPACE_MIN_WIDTH, Math.round(value)));
}

export function workspaceMaxWidthForLayout({
  sidebarWidth,
  viewportWidth: availableViewportWidth,
}: {
  sidebarWidth: number;
  viewportWidth: number;
}): number {
  const expandedLayoutMaxWidth = availableViewportWidth - sidebarWidth - WORKBENCH_MAIN_MIN_WIDTH;
  const collapsedLayoutMaxWidth = availableViewportWidth - WORKBENCH_MAIN_MIN_WIDTH;
  // The left sidebar can auto-collapse, so the workspace drag range should be
  // allowed to cross the expanded-layout limit and settle in the collapsed layout.
  const layoutMaxWidth = Math.max(expandedLayoutMaxWidth, collapsedLayoutMaxWidth);
  return Math.max(WORKSPACE_MIN_WIDTH, Math.floor(layoutMaxWidth));
}

export function workspaceMaxWidthForExpandedSidebar({
  sidebarWidth,
  viewportWidth: availableViewportWidth,
}: {
  sidebarWidth: number;
  viewportWidth: number;
}): number {
  const layoutMaxWidth = availableViewportWidth - sidebarWidth - WORKBENCH_EXPANDED_SIDEBAR_MAIN_MIN_WIDTH;
  return Math.max(WORKSPACE_MIN_WIDTH, Math.floor(layoutMaxWidth));
}

export function canWorkspaceWidthKeepExpandedSidebar({
  sidebarWidth,
  viewportWidth: availableViewportWidth,
  workspaceWidth,
}: {
  sidebarWidth: number;
  viewportWidth: number;
  workspaceWidth: number;
}): boolean {
  return workspaceWidth <= workspaceMaxWidthForExpandedSidebar({ sidebarWidth, viewportWidth: availableViewportWidth });
}

export function workspaceWidthCssValue(value: number, visible: boolean): string {
  return visible ? `${value}px` : '0px';
}

export function terminalHeightCssValue(value: number, visible: boolean): string {
  return visible ? `${value}px` : '0px';
}

export function clampTerminalHeightForLayout(
  value: number,
  {
    workbenchHeight,
  }: {
    workbenchHeight: number;
  },
): number {
  const layoutMaxHeight = workbenchHeight - WORKBENCH_MAIN_MIN_HEIGHT;
  const maxHeight = Math.max(TERMINAL_MIN_HEIGHT, Math.min(TERMINAL_MAX_HEIGHT, Math.floor(layoutMaxHeight)));
  return Math.min(maxHeight, Math.max(TERMINAL_MIN_HEIGHT, Math.round(value)));
}

function readShellPixelVariable(shell: HTMLElement | null, name: string, fallback: number): number {
  if (!shell || typeof window === 'undefined') return fallback;
  const value = Number.parseFloat(window.getComputedStyle(shell).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? WORKSPACE_MIN_WIDTH + SIDEBAR_MAX_WIDTH + WORKBENCH_MAIN_MIN_WIDTH : window.innerWidth * pageScaleInverse();
}

function readWorkbenchHeight(shell: HTMLElement | null): number {
  return shell?.querySelector<HTMLElement>('.app-workbench')?.clientHeight ?? viewportHeight();
}

function viewportHeight(): number {
  return typeof window === 'undefined' ? TERMINAL_MAX_HEIGHT + WORKBENCH_MAIN_MIN_HEIGHT : window.innerHeight * pageScaleInverse();
}

function pageScaleInverse(): number {
  if (typeof window === 'undefined') return 1;
  const value = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--app-page-scale-inverse'));
  return Number.isFinite(value) && value > 0 ? value : 1;
}
