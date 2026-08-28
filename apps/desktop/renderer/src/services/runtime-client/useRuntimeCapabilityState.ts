import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimeHookListResponse,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillList,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRuntimeHookManagement } from '../../features/capabilities/hooks/useRuntimeHookManagement.js';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';
import { reportRuntimeBackgroundFailure } from './runtimeClientErrors.js';

export type RuntimeCapabilityBootstrapResults = {
  skillResult: PromiseSettledResult<RuntimeSkillList>;
};

export type RuntimeCapabilityBootstrapValues = {
  skills?: RuntimeSkillSummary[];
};

export type RuntimeCapabilityClient = Pick<
  DesktopRuntimeClient,
  | 'authenticateSkillMcpDependency'
  | 'createSkill'
  | 'deleteSkill'
  | 'getConfig'
  | 'getSkill'
  | 'installSkillMcpDependencies'
  | 'listHooks'
  | 'listSkills'
  | 'saveConfig'
  | 'setSkillExtraRoots'
  | 'updateSkill'
>;

type RuntimeCapabilityStateOptions = {
  activeProjectPath?: string;
  client: RuntimeCapabilityClient;
  config: RuntimeConfigState | null;
  enabled: boolean;
  onConfigChange: (config: RuntimeConfigState) => void;
  onPluginSkillMutation?: () => Promise<void>;
};

export function capabilityBootstrapValues(
  results: RuntimeCapabilityBootstrapResults,
): RuntimeCapabilityBootstrapValues {
  const values: RuntimeCapabilityBootstrapValues = {};
  if (results.skillResult.status === 'fulfilled') {
    values.skills = results.skillResult.value.skills;
  }
  return values;
}

export function normalizeSkillExtraRoots(roots: string[]): string[] {
  return [...new Set(roots.map((root) => root.trim()).filter(Boolean))];
}

export function reportOptionalRuntimeLoadFailures(
  results: ReadonlyArray<readonly [domain: string, result: PromiseSettledResult<unknown>]>,
): void {
  for (const [domain, result] of results) {
    if (result.status === 'rejected') {
      console.warn(`[runtime] optional ${domain} state failed to load`, result.reason);
    }
  }
}

/** Owns the remaining Core renderer state and commands for Skill and Hook domains. */
export function useRuntimeCapabilityState({
  activeProjectPath,
  client,
  config,
  enabled,
  onConfigChange,
  onPluginSkillMutation,
}: RuntimeCapabilityStateOptions) {
  const [skills, setSkills] = useState<RuntimeSkillSummary[]>([]);
  const [skillExtraRoots, setSkillExtraRootsState] = useState<string[]>([]);
  const [hookState, setHookState] = useState<RuntimeHookListResponse | null>(null);
  const capabilityRequests = useLatestRequestGuard();
  const activeHookCwds = useMemo(
    () => (activeProjectPath ? [activeProjectPath] : []),
    [activeProjectPath],
  );

  const applyBootstrapResults = useCallback((results: RuntimeCapabilityBootstrapResults) => {
    const values = capabilityBootstrapValues(results);
    if (values.skills) setSkills(values.skills);
  }, []);

  const refreshCapabilities = useCallback(async () => {
    const isLatestRequest = capabilityRequests.begin();
    const results = await Promise.allSettled([
      client.listSkills(),
      client.listHooks(activeHookCwds),
    ]);
    const [skillResult, hookResult] = results;
    if (isLatestRequest()) {
      if (skillResult.status === 'fulfilled') setSkills(skillResult.value.skills);
      if (hookResult.status === 'fulfilled') setHookState(hookResult.value);
    }
    reportOptionalRuntimeLoadFailures([
      ['skills', skillResult],
      ['hooks', hookResult],
    ]);
    const firstFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (firstFailure && results.every((result) => result.status === 'rejected')) {
      throw firstFailure.reason;
    }
  }, [activeHookCwds, capabilityRequests, client]);

  const refreshHooks = useCallback(async () => {
    const isLatestRequest = capabilityRequests.begin();
    const hookList = await client.listHooks(activeHookCwds);
    if (isLatestRequest()) setHookState(hookList);
    return hookList;
  }, [activeHookCwds, capabilityRequests, client]);
  const hookManagement = useRuntimeHookManagement({ client, config, onConfigChange, refreshHooks });

  useEffect(() => {
    if (!enabled) return;
    void refreshHooks().catch((unknownError) => {
      reportRuntimeBackgroundFailure('hook refresh', unknownError);
    });
  }, [enabled, refreshHooks]);

  const updateSkill = useCallback(
    async (
      skill: RuntimeSkillSummary,
      patch: Partial<RuntimeSkillInput>,
    ): Promise<RuntimeSkillDetail> => {
      const updated = await client.updateSkill(skill.id, patch);
      setSkills((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      if (skill.kind === 'plugin') await onPluginSkillMutation?.();
      return updated;
    },
    [client, onPluginSkillMutation],
  );

  const createSkill = useCallback(
    async (input: RuntimeSkillInput): Promise<RuntimeSkillDetail> => {
      const created = await client.createSkill(input);
      setSkills((items) => [
        ...items.filter((item) => item.id !== created.id),
        created,
      ].sort((left, right) => left.name.localeCompare(right.name)));
      return created;
    },
    [client],
  );

  const getSkillDetail = useCallback(
    async (skillId: string): Promise<RuntimeSkillDetail> => client.getSkill(skillId),
    [client],
  );

  const deleteSkill = useCallback(
    async (skill: RuntimeSkillSummary): Promise<void> => {
      await client.deleteSkill(skill.id);
      setSkills((items) => items.filter((item) => item.id !== skill.id));
      if (skill.kind === 'plugin') await onPluginSkillMutation?.();
    },
    [client, onPluginSkillMutation],
  );

  const installSkillMcpDependencies = useCallback(
    async (skill: RuntimeSkillSummary): Promise<RuntimeSkillDetail> => {
      const result = await client.installSkillMcpDependencies(skill.id);
      const skillList = await client.listSkills();
      setSkills(skillList.skills);
      return result.skill;
    },
    [client],
  );

  const authenticateSkillMcpDependency = useCallback(
    async (skill: RuntimeSkillSummary, serverKey: string): Promise<RuntimeSkillDetail> => {
      const updated = await client.authenticateSkillMcpDependency(skill.id, serverKey);
      const skillList = await client.listSkills();
      setSkills(skillList.skills);
      return updated;
    },
    [client],
  );

  const setSkillExtraRoots = useCallback(async (roots: string[]) => {
    const normalizedRoots = normalizeSkillExtraRoots(roots);
    await client.setSkillExtraRoots(normalizedRoots);
    const skillList = await client.listSkills();
    setSkillExtraRootsState(normalizedRoots);
    setSkills(skillList.skills);
  }, [client]);

  // Plugin bundle mutations may add/remove Skills, Hooks, and Hook config. The
  // composition host refreshes the independent MCP Feature service alongside this call.
  const refreshCapabilityDependencies = useCallback(async () => {
    const [nextConfig] = await Promise.all([
      client.getConfig(),
      refreshCapabilities(),
    ]);
    onConfigChange(nextConfig);
    return nextConfig;
  }, [client, onConfigChange, refreshCapabilities]);

  return {
    applyBootstrapResults,
    authenticateSkillMcpDependency,
    createSkill,
    deleteSkill,
    getSkillDetail,
    hookState,
    ...hookManagement,
    installSkillMcpDependencies,
    refreshCapabilities,
    refreshCapabilityDependencies,
    setSkillExtraRoots,
    skillExtraRoots,
    skills,
    updateSkill,
  };
}
