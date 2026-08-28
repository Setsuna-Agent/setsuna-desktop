import type {
  RuntimeSkillInput,
  RuntimeSkillPatch,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import { useCallback, useMemo } from 'react';
import { usePluginManagementFeatureService } from './PluginManagementFeatureBoundary.js';
import { useSkillsFeature } from './SkillsFeatureBoundary.js';

/** Adapts the Skills Feature service to existing settings, chat, and catalog props. */
export function useSkillsCapabilities() {
  const { service, snapshot } = useSkillsFeature();
  const pluginManagement = usePluginManagementFeatureService();

  const createSkill = useCallback((input: RuntimeSkillInput) => (
    service.createSkill(input)
  ), [service]);

  const getSkillDetail = useCallback((skillId: string) => (
    service.getSkill(skillId)
  ), [service]);

  const updateSkill = useCallback(async (
    skill: RuntimeSkillSummary,
    patch: Partial<RuntimeSkillInput>,
  ) => {
    const { id: _ignoredId, ...skillPatch } = patch;
    const updated = await service.updateSkill(skill.id, skillPatch as RuntimeSkillPatch);
    if (skill.kind === 'plugin') await pluginManagement.refreshInstalled();
    return updated;
  }, [pluginManagement, service]);

  const deleteSkill = useCallback(async (skill: RuntimeSkillSummary) => {
    await service.deleteSkill(skill.id);
    if (skill.kind === 'plugin') await pluginManagement.refreshInstalled();
  }, [pluginManagement, service]);

  const installMcpDependencies = useCallback((skill: RuntimeSkillSummary) => (
    service.installMcpDependencies(skill.id).then((result) => result.skill)
  ), [service]);

  const authenticateMcpDependency = useCallback((
    skill: RuntimeSkillSummary,
    serverKey: string,
  ) => service.authenticateMcpDependency(skill.id, serverKey), [service]);

  const values = useMemo(() => ({
    extraRoots: [...snapshot.extraRoots],
    skills: [...snapshot.skills],
  }), [snapshot]);

  const refresh = useCallback(() => service.refresh(), [service]);
  const setExtraRoots = useCallback(async (roots: string[]) => {
    await service.setExtraRoots(roots);
  }, [service]);

  return {
    ...values,
    authenticateMcpDependency,
    createSkill,
    deleteSkill,
    getSkillDetail,
    installMcpDependencies,
    refresh,
    setExtraRoots,
    updateSkill,
  };
}
