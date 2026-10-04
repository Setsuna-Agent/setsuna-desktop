import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  chatComposerTargetIdentity,
  chatComposerNewThreadTarget,
  type ChatComposerTargetIdentity,
} from '../../chat/hooks/useChatComposerSession.js';
import {
  createEmptyPanelSlot,
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
  const next = { ...layouts };
  delete next[targetIdentity];
  return next;
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
export function useDesktopWorkspacePanelSession(targetIdentity: ChatComposerTargetIdentity) {
  const targetIdentityRef = useRef(targetIdentity);
  targetIdentityRef.current = targetIdentity;
  const [layouts, setLayouts] = useState<DesktopWorkspacePanelLayouts>({});
  const layout = desktopWorkspacePanelLayout(layouts, targetIdentity);

  const updateLayoutForIdentity = useCallback((
    identity: ChatComposerTargetIdentity,
    updater: (current: DesktopWorkspacePanelLayout) => DesktopWorkspacePanelLayout,
  ) => {
    setLayouts((current) => updateDesktopWorkspacePanelLayout(current, identity, updater));
  }, []);

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
    setLayouts((current) => resetDesktopWorkspacePanelLayout(current, identity));
  }, []);

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
  }, []);

  const claimForThread = useCallback((threadId: string) => {
    setLayouts((current) => claimDesktopWorkspacePanelLayout(current, targetIdentityRef.current, threadId));
  }, []);

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
