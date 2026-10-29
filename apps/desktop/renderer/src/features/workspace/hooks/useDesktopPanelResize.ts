import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';

type CssVariableName = string | readonly string[];
type DesktopPanelResizeOptions = {
  bottomPanelVisible?: boolean;
  sidebarManuallyCollapsed?: boolean;
  sidebarManuallyExpanded?: boolean;
  workspaceVisible?: boolean;
};

const SIDEBAR_WIDTH_VARIABLES = ['--app-sidebar-width', '--app-topbar-sidebar-width'] as const;
const SIDEBAR_MIN_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 360;
export const WORKBENCH_MAIN_MIN_WIDTH = 420;
export const WORKBENCH_SPLIT_MAIN_MIN_WIDTH = 520;
const WORKBENCH_MAIN_MIN_HEIGHT = 260;
const WORKSPACE_MIN_WIDTH = 410;
const COMPACT_PANEL_MIN_FRACTION = 0.4;
const TERMINAL_MIN_HEIGHT = 180;
const TERMINAL_MAX_HEIGHT = 520;

export function useDesktopPanelResize(
  shellRef: RefObject<HTMLDivElement | null>,
  { bottomPanelVisible = true, sidebarManuallyCollapsed = false, sidebarManuallyExpanded = false, workspaceVisible = true }: DesktopPanelResizeOptions = {},
) {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const defaultWorkspaceWidth = useCallback(() => workspaceDefaultWidthForLayout({
    sidebarWidth: sidebarManuallyCollapsed ? 0 : sidebarWidth,
    viewportWidth: readWorkbenchWidth(shellRef.current),
    keepSidebarExpanded: sidebarManuallyExpanded,
  }), [shellRef, sidebarManuallyCollapsed, sidebarManuallyExpanded, sidebarWidth]);
  const [workspaceWidth, setWorkspaceWidth] = useState(defaultWorkspaceWidth);
  const preferredWorkspaceWidthRef = useRef<number | null>(null);
  const [workspaceRestoreWidth, setWorkspaceRestoreWidth] = useState<number | null>(null);
  const [workspacePreviewWidth, setWorkspacePreviewWidth] = useState<number | null>(null);
  const [workbenchWidth, setWorkbenchWidth] = useState(() => readWorkbenchWidth(shellRef.current));
  const [terminalHeight, setTerminalHeight] = useState(260);
  const workspacePreviewCanFitSidebarRef = useRef<boolean | null>(null);
  const workspaceMaximized = workspaceRestoreWidth !== null;
  const workspaceSinglePane = workspaceVisible && workspaceMaximized;
  const setPreferredWorkspaceWidth = useCallback<Dispatch<SetStateAction<number>>>((value) => {
    setWorkspaceWidth((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      preferredWorkspaceWidthRef.current = next;
      return next;
    });
  }, []);
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
    (value: number) => {
      const layout = {
        sidebarWidth: sidebarManuallyExpanded ? sidebarWidth : readShellPixelVariable(shellRef.current, '--app-sidebar-width', sidebarWidth),
        viewportWidth: readWorkbenchWidth(shellRef.current),
      };
      const clamped = clampWorkspaceWidthForLayout(value, layout);
      return sidebarManuallyExpanded ? Math.min(clamped, workspaceMaxWidthForExpandedSidebar(layout)) : clamped;
    },
    [shellRef, sidebarManuallyExpanded, sidebarWidth],
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
        viewportWidth: readWorkbenchWidth(shellRef.current),
        workspaceWidth: value,
      }),
    [shellRef, sidebarWidth],
  );
  const beginWorkspacePreviewResize = useCallback(
    (value: number) => {
      preferredWorkspaceWidthRef.current = value;
      setWorkspaceRestoreWidth(null);
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
    setValue: setPreferredWorkspaceWidth,
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
    (delta: number) => {
      setWorkspaceRestoreWidth(null);
      stepResizeValue('--desktop-agent-workspace-width', clampWorkspaceWidth, setPreferredWorkspaceWidth, delta);
    },
    [clampWorkspaceWidth, setPreferredWorkspaceWidth, stepResizeValue],
  );
  const toggleWorkspaceMaximized = useCallback(() => {
    preferredWorkspaceWidthRef.current ??= workspaceWidth;
    // Keep the normal width separate so resizing the window while maximized does not overwrite it.
    const nextValue = clampWorkspaceWidth(workspaceRestoreWidth ?? workspaceWidth);
    setWorkspaceRestoreWidth(workspaceMaximized ? null : workspaceWidth);
    endWorkspacePreviewResize();
    setWorkspaceWidth(nextValue);
    setShellVariables('--desktop-agent-workspace-width', workspaceWidthCssValue(nextValue, workspaceVisible));
  }, [clampWorkspaceWidth, endWorkspacePreviewResize, setShellVariables, workspaceMaximized, workspaceRestoreWidth, workspaceVisible, workspaceWidth]);
  const fitWorkspaceForExpandedSidebar = useCallback(() => {
    const expandedLayout = {
      sidebarWidth,
      viewportWidth: readWorkbenchWidth(shellRef.current),
    };
    const maxExpandedWorkspaceWidth = workspaceMaxWidthForExpandedSidebar(expandedLayout);
    workspacePreviewCanFitSidebarRef.current = null;
    setWorkspaceRestoreWidth(null);
    setWorkspacePreviewWidth(null);
    setWorkspaceWidth((current) => {
      const preferredWidth = preferredWorkspaceWidthRef.current ?? workspaceDefaultWidthForLayout({ ...expandedLayout, keepSidebarExpanded: true });
      const nextValue = Math.min(preferredWidth, maxExpandedWorkspaceWidth);
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
        const availableWidth = readWorkbenchWidth(shellRef.current);
        setWorkbenchWidth(availableWidth);
        setWorkspaceWidth((current) => {
          // Only an explicit maximize command may hide the conversation.
          if (workspaceMaximized) {
            setShellVariables('--desktop-agent-workspace-width', workspaceWidthCssValue(availableWidth, workspaceVisible));
            return current;
          }
          // Window constraints affect the rendered width, not the user's split preference.
          const preferredWidth = preferredWorkspaceWidthRef.current ?? defaultWorkspaceWidth();
          const nextValue = clampWorkspaceWidth(preferredWidth);
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
    const workbench = shellRef.current?.querySelector('.app-workbench');
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncResponsiveBounds);
    if (workbench) observer?.observe(workbench);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', syncResponsiveBounds);
      observer?.disconnect();
    };
  }, [bottomPanelVisible, clampTerminalHeight, clampWorkspaceWidth, defaultWorkspaceWidth, setShellVariables, shellRef, workspaceMaximized, workspaceVisible]);

  const terminalMaxHeight = clampTerminalHeight(TERMINAL_MAX_HEIGHT);
  const workspaceMaxWidth = clampWorkspaceWidth(Number.POSITIVE_INFINITY);
  const workspaceLayoutWidth = workspaceSinglePane ? workbenchWidth : workspacePreviewWidth ?? workspaceWidth;

  return {
    handleSidebarResizeStep,
    handleSidebarResizeStart,
    handleTerminalResizeStep,
    handleTerminalResizeStart,
    handleWorkspaceResizeStep,
    handleWorkspaceResizeStart,
    fitWorkspaceForExpandedSidebar,
    toggleWorkspaceMaximized,
    sidebarMaxWidth: SIDEBAR_MAX_WIDTH,
    sidebarMinWidth: SIDEBAR_MIN_WIDTH,
    sidebarWidth,
    terminalMaxHeight,
    terminalHeight,
    terminalMinHeight: TERMINAL_MIN_HEIGHT,
    workspaceMaxWidth,
    workspaceMaximized,
    workspaceSinglePane,
    workspaceMinWidth: workspaceMinimumWidth(workbenchWidth - (sidebarManuallyExpanded ? sidebarWidth : 0)),
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

function workspaceDefaultWidthForLayout({ sidebarWidth, viewportWidth: availableViewportWidth, keepSidebarExpanded = false }: {
  sidebarWidth: number;
  viewportWidth: number;
  keepSidebarExpanded?: boolean;
}): number {
  // Predict the existing sidebar auto-collapse before splitting, so its CSS
  // transition cannot feed a stale width back into the default panel size.
  const reservedSidebarWidth = keepSidebarExpanded || availableViewportWidth - sidebarWidth >= WORKBENCH_SPLIT_MAIN_MIN_WIDTH * 2
    ? sidebarWidth : 0;
  return clampWorkspaceWidthForLayout((availableViewportWidth - reservedSidebarWidth) / 2, {
    sidebarWidth: reservedSidebarWidth,
    viewportWidth: availableViewportWidth,
  });
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
  return Math.min(maxWidth, Math.max(workspaceMinimumWidth(availableViewportWidth - sidebarWidth), Math.round(value)));
}

function workspaceMinimumWidth(availableWidth: number): number {
  return Math.min(WORKSPACE_MIN_WIDTH, Math.floor(Math.max(0, availableWidth) * COMPACT_PANEL_MIN_FRACTION));
}

export function workspaceMaxWidthForLayout({ viewportWidth: availableViewportWidth }: {
  sidebarWidth: number;
  viewportWidth: number;
}): number {
  const width = Math.max(0, availableViewportWidth);
  // Soften desktop minimums in compact windows, keeping both panes visible and resizable.
  // The sidebar may auto-collapse while dragging, so this bound uses its collapsed layout.
  const mainMinWidth = Math.min(WORKBENCH_SPLIT_MAIN_MIN_WIDTH, width * COMPACT_PANEL_MIN_FRACTION);
  return Math.floor(width - mainMinWidth);
}

export function workspaceMaxWidthForExpandedSidebar({
  sidebarWidth,
  viewportWidth: availableViewportWidth,
}: {
  sidebarWidth: number;
  viewportWidth: number;
}): number {
  return workspaceMaxWidthForLayout({ sidebarWidth: 0, viewportWidth: availableViewportWidth - sidebarWidth });
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
  return typeof window === 'undefined' ? WORKSPACE_MIN_WIDTH + SIDEBAR_MAX_WIDTH + WORKBENCH_SPLIT_MAIN_MIN_WIDTH : window.innerWidth * pageScaleInverse();
}

/** Use the content surface width so the global navigation rail never consumes panel space. */
export function readWorkbenchWidth(shell: HTMLElement | null): number {
  return shell?.querySelector<HTMLElement>('.app-workbench')?.clientWidth ?? shell?.clientWidth ?? viewportWidth();
}

function readWorkbenchHeight(shell: HTMLElement | null): number {
  const workbench = shell?.querySelector<HTMLElement>('.app-workbench');
  const headerHeight = workbench?.querySelector<HTMLElement>('.app-content-header')?.offsetHeight ?? 0;
  // Windows content headers share the workbench but cannot be resized by the terminal.
  return Math.max(0, (workbench?.clientHeight ?? viewportHeight()) - headerHeight);
}

function viewportHeight(): number {
  return typeof window === 'undefined' ? TERMINAL_MAX_HEIGHT + WORKBENCH_MAIN_MIN_HEIGHT : window.innerHeight * pageScaleInverse();
}

function pageScaleInverse(): number {
  if (typeof window === 'undefined') return 1;
  const value = Number.parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--app-page-scale-inverse'));
  return Number.isFinite(value) && value > 0 ? value : 1;
}
