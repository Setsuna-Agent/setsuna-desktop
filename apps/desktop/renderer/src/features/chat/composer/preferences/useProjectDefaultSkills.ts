import type { RuntimeSkillSummary, RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import { usePageSessionState } from '@setsuna-desktop/renderer-ui';
import { useEffect, useId, type RefObject, type ComponentRef } from 'react';
import type { ChatPromptInput } from '../editor/ChatPromptInput.js';
import { createSelectedSkillSlot, createTextSlot } from '../chatComposerSlots.js';

export function useProjectDefaultSkills({ preferenceKey, currentThread, activeProject, skills, draft, senderRef, addSelectedSkills }: {
  preferenceKey?: string;
  currentThread: RuntimeThread | null; activeProject?: WorkspaceProject; skills: RuntimeSkillSummary[];
  draft: string; senderRef: RefObject<ComponentRef<typeof ChatPromptInput>>;
  addSelectedSkills(skills: RuntimeSkillSummary[]): void;
}) {
  const projectDefaults = activeProject?.conversationDefaults;
  const instanceId = useId();
  const [defaultsApplied, setDefaultsApplied] = usePageSessionState(`chat:${preferenceKey ?? instanceId}:skills-initialized`, false);
  useEffect(() => {
    if (defaultsApplied || currentThread || !projectDefaults?.skillIds?.length) return;
    if (!skills.length) return;
    setDefaultsApplied(true);
    if (draft.trim() || senderRef.current?.getValue().value.trim()) return;
    const defaults = skills.filter((skill) => skill.enabled && projectDefaults.skillIds!.includes(skill.id));
    if (!defaults.length) return;
    const focused = document.activeElement;
    senderRef.current?.insert(defaults.flatMap((skill) => [createSelectedSkillSlot(skill), createTextSlot(' ')]), 'end');
    addSelectedSkills(defaults);
    if (focused instanceof HTMLElement && focused !== document.body && focused !== senderRef.current?.inputElement) focused.focus({ preventScroll: true });
  }, [addSelectedSkills, currentThread, defaultsApplied, draft, projectDefaults, setDefaultsApplied, skills, senderRef]);

}
