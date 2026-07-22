import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  chatComposerTargetIdentity,
  type ChatComposerTargetIdentity,
} from '../../chat/hooks/useChatComposerSession.js';
import {
  createEmptyPanelSlot,
  type DesktopPanelSlotState,
  type DesktopPanelTab,
} from '../model.js';

export type DesktopWorkspacePanelLayout = {
  bottomPanelSlot: DesktopPanelSlotState;
  sidePanelExpanded: boolean;
  sidePanelSlot: DesktopPanelSlotState;
};

export type DesktopWorkspacePanelLayouts = Partial<Record<ChatComposerTargetIdentity, DesktopWorkspacePanelLayout>>;

export type DesktopWorkspaceBrowserPanelInstance = {
  active: boolean;
  panel: DesktopPanelTab;
  targetIdentity: ChatComposerTargetIdentity;
};

const EMPTY_PANEL_LAYOUT: DesktopWorkspacePanelLayout = {
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
  if (!fromIdentity.startsWith('new-thread-slot:')) return layouts;
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
  activeLayoutVisible: boolean,
): DesktopWorkspaceBrowserPanelInstance[] {
  const instances: DesktopWorkspaceBrowserPanelInstance[] = [];
  for (const targetIdentity of Object.keys(layouts) as ChatComposerTargetIdentity[]) {
    const layout = layouts[targetIdentity];
    if (!layout) continue;
    for (const panel of layout.sidePanelSlot.panels) {
      if (panel.type !== 'browser') continue;
      instances.push({
        active: targetIdentity === activeIdentity
          && activeLayoutVisible
          && layout.sidePanelSlot.active === panel.id,
        panel,
        targetIdentity,
      });
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

  const layoutForIdentity = useCallback(
    (identity: ChatComposerTargetIdentity) => desktopWorkspacePanelLayout(layouts, identity),
    [layouts],
  );

  const resetForIdentity = useCallback((identity: ChatComposerTargetIdentity) => {
    setLayouts((current) => resetDesktopWorkspacePanelLayout(current, identity));
  }, []);

  const claimForThread = useCallback((threadId: string) => {
    setLayouts((current) => claimDesktopWorkspacePanelLayout(current, targetIdentityRef.current, threadId));
  }, []);

  return {
    bottomPanelSlot: layout.bottomPanelSlot,
    claimForThread,
    layoutForIdentity,
    layouts,
    resetForIdentity,
    setBottomPanelSlot,
    setSidePanelExpanded,
    setSidePanelSlot,
    sidePanelExpanded: layout.sidePanelExpanded,
    sidePanelSlot: layout.sidePanelSlot,
    updateLayoutForIdentity,
  };
}
