import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useSessionWriter } from '../../../shared/preferences/sessionStorage.js';
import { readWorkspaceLayout, savedWorkspaceLayout } from '../workspaceSessionRecovery.js';
import {
  chatComposerTargetIdentity,
  chatComposerNewThreadTarget,
  type ChatComposerTargetIdentity,
} from '../../chat/hooks/useChatComposerSession.js';
import {
  createEmptyPanelSlot,
  reconcilePanelRoots,
  removePanelFromSlotState,
  type DesktopPanelSlot,
  type DesktopPanelSlotState,
  type DesktopPanelTab,
} from '../model.js';

export type DesktopWorkspacePanelLayout = {
  bottomPanelExpanded: boolean;
  bottomPanelSlot: DesktopPanelSlotState;
  sidePanelExpanded: boolean;
  sidePanelSlot: DesktopPanelSlotState;
};

export type DesktopWorkspacePanelLayouts = Partial<Record<ChatComposerTargetIdentity, DesktopWorkspacePanelLayout>>;

export type DesktopWorkspaceBrowserPanelInstance = {
  active: boolean;
  panel: DesktopPanelTab;
  placement: DesktopPanelSlot;
  targetIdentity: ChatComposerTargetIdentity;
};

export type DesktopWorkspacePanelTargetContext = {
  projectId: string | null;
  threadId: string | null;
};

const EMPTY_PANEL_LAYOUT: DesktopWorkspacePanelLayout = {
  bottomPanelExpanded: false,
  bottomPanelSlot: createEmptyPanelSlot(),
  sidePanelExpanded: false,
  sidePanelSlot: createEmptyPanelSlot(),
};

export function desktopWorkspacePanelLayout(
  layouts: DesktopWorkspacePanelLayouts,
  targetIdentity: ChatComposerTargetIdentity,
): DesktopWorkspacePanelLayout {
  return layouts[targetIdentity] ?? EMPTY_PANEL_LAYOUT;
}

export function desktopWorkspacePanelTargetContext(
  targetIdentity: ChatComposerTargetIdentity,
  projectIdByThreadId: ReadonlyMap<string, string | undefined>,
): DesktopWorkspacePanelTargetContext {
  if (targetIdentity.startsWith('thread:')) {
    const threadId = targetIdentity.slice('thread:'.length);
    return {
      projectId: projectIdByThreadId.get(threadId) ?? null,
      threadId,
    };
  }
  return {
    projectId: chatComposerNewThreadTarget(targetIdentity)!.projectId,
    threadId: null,
  };
}

export function updateDesktopWorkspacePanelLayout(
  layouts: DesktopWorkspacePanelLayouts,
  targetIdentity: ChatComposerTargetIdentity,
  updater: (current: DesktopWorkspacePanelLayout) => DesktopWorkspacePanelLayout,
): DesktopWorkspacePanelLayouts {
  const current = desktopWorkspacePanelLayout(layouts, targetIdentity);
  const nextLayout = updater(current);
  if (nextLayout === current) return layouts;
  return { ...layouts, [targetIdentity]: nextLayout };
}

export function resetDesktopWorkspacePanelLayout(
  layouts: DesktopWorkspacePanelLayouts,
  targetIdentity: ChatComposerTargetIdentity,
): DesktopWorkspacePanelLayouts {
  if (!layouts[targetIdentity]) return layouts;
  return { ...layouts, [targetIdentity]: { ...EMPTY_PANEL_LAYOUT } };
}

export function claimDesktopWorkspacePanelLayout(
  layouts: DesktopWorkspacePanelLayouts,
  fromIdentity: ChatComposerTargetIdentity,
  threadId: string,
): DesktopWorkspacePanelLayouts {
  if (!chatComposerNewThreadTarget(fromIdentity)) return layouts;
  const toIdentity = chatComposerTargetIdentity(threadId, null);
  const sourceLayout = layouts[fromIdentity];
  if (!sourceLayout) return layouts;
  const next: DesktopWorkspacePanelLayouts = { ...layouts, [toIdentity]: sourceLayout };
  delete next[fromIdentity];
  return next;
}

/** Returns every browser tab so inactive conversations can stay mounted without becoming visible. */
export function desktopWorkspaceBrowserPanelInstances(
  layouts: DesktopWorkspacePanelLayouts,
  activeIdentity: ChatComposerTargetIdentity,
  visibility: { bottomVisible: boolean; sideVisible: boolean },
): DesktopWorkspaceBrowserPanelInstance[] {
  const instances: DesktopWorkspaceBrowserPanelInstance[] = [];
  for (const targetIdentity of Object.keys(layouts) as ChatComposerTargetIdentity[]) {
    const layout = layouts[targetIdentity];
    if (!layout) continue;
    const slots: Array<[DesktopPanelSlot, DesktopPanelSlotState]> = [
      ['side', layout.sidePanelSlot],
      ['bottom', layout.bottomPanelSlot],
    ];
    for (const [placement, slot] of slots) {
      for (const panel of slot.panels) {
        if (panel.type !== 'browser') continue;
        instances.push({
          active: targetIdentity === activeIdentity
            && (placement === 'side' ? visibility.sideVisible : visibility.bottomVisible)
            && slot.active === panel.id,
          panel,
          placement,
          targetIdentity,
        });
      }
    }
  }
  return instances;
}

/** Keeps side and bottom panel layouts isolated by conversation identity. */
export function useDesktopWorkspacePanelSession(
  targetIdentity: ChatComposerTargetIdentity,
  windowKey: string | null = null,
  rootIds?: ReadonlySet<string>,
) {
  const targetIdentityRef = useRef(targetIdentity);
  targetIdentityRef.current = targetIdentity;
  const writer = useSessionWriter(windowKey, 'panels');
  const [stored, setStored] = useState(() => ({ windowKey, layouts: {
    [targetIdentity]: windowKey ? readWorkspaceLayout(windowKey, targetIdentity) : EMPTY_PANEL_LAYOUT,
  } as DesktopWorkspacePanelLayouts }));
  // If the user opens or closes tabs before deferred recovery, their edits win.
  // Unvisited/untouched empty placeholders must still be eligible for recovery.
  let layouts = stored.windowKey === windowKey ? stored.layouts
    : Object.fromEntries(Object.entries(stored.layouts).filter(([, layout]) => layout !== EMPTY_PANEL_LAYOUT));
  if (!layouts[targetIdentity]) {
    layouts = { ...layouts, [targetIdentity]: windowKey ? readWorkspaceLayout(windowKey, targetIdentity) : EMPTY_PANEL_LAYOUT };
  }
  const currentLayout = desktopWorkspacePanelLayout(layouts, targetIdentity);
  const layout = useMemo(() => {
    if (!rootIds) return currentLayout;
    const sidePanelSlot = reconcilePanelRoots(currentLayout.sidePanelSlot, rootIds);
    const bottomPanelSlot = reconcilePanelRoots(currentLayout.bottomPanelSlot, rootIds);
    return sidePanelSlot === currentLayout.sidePanelSlot && bottomPanelSlot === currentLayout.bottomPanelSlot
      ? currentLayout : { ...currentLayout, sidePanelSlot, bottomPanelSlot };
  }, [currentLayout, rootIds]);
  // Recovery can finish after the workspace is ready. Validate before publishing
  // active tabs so preview/terminal effects never consume removed directory bindings.
  if (layout !== currentLayout) layouts = { ...layouts, [targetIdentity]: layout };
  if (layouts !== stored.layouts) {
    setStored({ windowKey, layouts });
  }
  const setLayouts = useCallback<Dispatch<SetStateAction<DesktopWorkspacePanelLayouts>>>((update) => {
    setStored((current) => ({ ...current, layouts: typeof update === 'function' ? update(current.layouts) : update }));
  }, []);
  const previousLayoutsRef = useRef({ windowKey, layouts });
  useEffect(() => {
    const previous = previousLayoutsRef.current;
    previousLayoutsRef.current = { windowKey, layouts };
    for (const identity of Object.keys(layouts) as ChatComposerTargetIdentity[]) {
      const layout = layouts[identity];
      const changed = previous.windowKey === windowKey ? layout !== previous.layouts[identity]
        : layout === previous.layouts[identity] && layout !== EMPTY_PANEL_LAYOUT;
      if (layout && changed) writer.write(identity, savedWorkspaceLayout(layout));
    }
    if (previous.windowKey === windowKey) {
      for (const identity of Object.keys(previous.layouts)) if (!(identity in layouts)) writer.write(identity, null);
    }
  }, [layouts, windowKey, writer]);
  const updateLayoutForIdentity = useCallback((
    identity: ChatComposerTargetIdentity,
    updater: (current: DesktopWorkspacePanelLayout) => DesktopWorkspacePanelLayout,
  ) => {
    setLayouts((current) => updateDesktopWorkspacePanelLayout(current, identity, updater));
  }, [setLayouts]);

  const updateLayout = useCallback((updater: (current: DesktopWorkspacePanelLayout) => DesktopWorkspacePanelLayout) => {
    updateLayoutForIdentity(targetIdentity, updater);
  }, [targetIdentity, updateLayoutForIdentity]);

  const setSidePanelSlot = useCallback<Dispatch<SetStateAction<DesktopPanelSlotState>>>((value) => {
    updateLayout((current) => {
      const sidePanelSlot = typeof value === 'function' ? value(current.sidePanelSlot) : value;
      return sidePanelSlot === current.sidePanelSlot ? current : { ...current, sidePanelSlot };
    });
  }, [updateLayout]);

  const setSidePanelExpanded = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    updateLayout((current) => {
      const sidePanelExpanded = typeof value === 'function' ? value(current.sidePanelExpanded) : value;
      return sidePanelExpanded === current.sidePanelExpanded ? current : { ...current, sidePanelExpanded };
    });
  }, [updateLayout]);

  const setBottomPanelSlot = useCallback<Dispatch<SetStateAction<DesktopPanelSlotState>>>((value) => {
    updateLayout((current) => {
      const bottomPanelSlot = typeof value === 'function' ? value(current.bottomPanelSlot) : value;
      return bottomPanelSlot === current.bottomPanelSlot ? current : { ...current, bottomPanelSlot };
    });
  }, [updateLayout]);

  const setBottomPanelExpanded = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    updateLayout((current) => {
      const bottomPanelExpanded = typeof value === 'function' ? value(current.bottomPanelExpanded) : value;
      return bottomPanelExpanded === current.bottomPanelExpanded ? current : { ...current, bottomPanelExpanded };
    });
  }, [updateLayout]);

  const layoutForIdentity = useCallback(
    (identity: ChatComposerTargetIdentity) => desktopWorkspacePanelLayout(layouts, identity),
    [layouts],
  );

  const resetForIdentity = useCallback((identity: ChatComposerTargetIdentity) => {
    writer.write(identity, null);
    // Keep a visited empty entry so a same-render revisit cannot reload a queued old save.
    setLayouts((current) => resetDesktopWorkspacePanelLayout(current, identity));
  }, [setLayouts, writer]);

  const removePanel = useCallback((panelId: string) => {
    setLayouts((current) => {
      let next = current;
      for (const identity of Object.keys(current) as ChatComposerTargetIdentity[]) {
        next = updateDesktopWorkspacePanelLayout(next, identity, (layout) => {
          const sidePanelSlot = removePanelFromSlotState(layout.sidePanelSlot, panelId);
          const bottomPanelSlot = removePanelFromSlotState(layout.bottomPanelSlot, panelId);
          if (sidePanelSlot === layout.sidePanelSlot && bottomPanelSlot === layout.bottomPanelSlot) return layout;
          return {
            ...layout, sidePanelSlot, bottomPanelSlot,
            sidePanelExpanded: layout.sidePanelExpanded && sidePanelSlot.panels.length > 0,
            bottomPanelExpanded: layout.bottomPanelExpanded && bottomPanelSlot.panels.length > 0,
          };
        });
      }
      return next;
    });
  }, [setLayouts]);

  const claimForThread = useCallback((threadId: string) => {
    setLayouts((current) => {
      const identity = targetIdentityRef.current;
      const next = claimDesktopWorkspacePanelLayout(current, identity, threadId);
      return next === current ? current : { ...next, [identity]: { ...EMPTY_PANEL_LAYOUT } };
    });
  }, [setLayouts]);

  return {
    bottomPanelExpanded: layout.bottomPanelExpanded,
    bottomPanelSlot: layout.bottomPanelSlot,
    claimForThread,
    layoutForIdentity,
    layouts,
    removePanel,
    resetForIdentity,
    setBottomPanelExpanded,
    setBottomPanelSlot,
    setSidePanelExpanded,
    setSidePanelSlot,
    sidePanelExpanded: layout.sidePanelExpanded,
    sidePanelSlot: layout.sidePanelSlot,
    updateLayoutForIdentity,
  };
}
