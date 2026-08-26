import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimeHookListResponse,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpToolList,
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
  mcpResult: PromiseSettledResult<RuntimeMcpServerList>;
};

export type RuntimeCapabilityBootstrapValues = {
  skills?: RuntimeSkillSummary[];
  mcpState?: RuntimeMcpServerList;
};

export type RuntimeCapabilityClient = Pick<
  DesktopRuntimeClient,
  | 'authenticateSkillMcpDependency'
  | 'createSkill'
  | 'deleteMcpServer'
  | 'deleteSkill'
  | 'fetchMcpServerTools'
  | 'getConfig'
  | 'getSkill'
  | 'installSkillMcpDependencies'
  | 'listHooks'
  | 'listMcpServers'
  | 'listSkills'
  | 'loginMcpServer'
  | 'logoutMcpServer'
  | 'saveConfig'
  | 'setSkillExtraRoots'
  | 'updateMcpServer'
  | 'updateSkill'
  | 'upsertMcpServer'
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
  if (results.mcpResult.status === 'fulfilled') {
    values.mcpState = results.mcpResult.value;
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

/** Owns renderer state and commands for the shared Skill, MCP, and Hook domains. */
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
  const [mcpState, setMcpState] = useState<RuntimeMcpServerList | null>(null);
  const [hookState, setHookState] = useState<RuntimeHookListResponse | null>(null);
  const capabilityRequests = useLatestRequestGuard();
  const activeHookCwds = useMemo(
    () => (activeProjectPath ? [activeProjectPath] : []),
    [activeProjectPath],
  );

  const applyBootstrapResults = useCallback((results: RuntimeCapabilityBootstrapResults) => {
    const values = capabilityBootstrapValues(results);
    if (values.skills) setSkills(values.skills);
    if (values.mcpState) setMcpState(values.mcpState);
  }, []);

  const refreshCapabilities = useCallback(async () => {
    const isLatestRequest = capabilityRequests.begin();
    const results = await Promise.allSettled([
      client.listSkills(),
      client.listMcpServers(),
      client.listHooks(activeHookCwds),
    ]);
    const [skillResult, mcpResult, hookResult] = results;
    if (isLatestRequest()) {
      if (skillResult.status === 'fulfilled') setSkills(skillResult.value.skills);
      if (mcpResult.status === 'fulfilled') setMcpState(mcpResult.value);
      if (hookResult.status === 'fulfilled') setHookState(hookResult.value);
    }
    reportOptionalRuntimeLoadFailures([
      ['skills', skillResult],
      ['MCP', mcpResult],
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
      const [skillList, nextMcpState] = await Promise.all([
        client.listSkills(),
        client.listMcpServers(),
      ]);
      setSkills(skillList.skills);
      setMcpState(nextMcpState);
      return result.skill;
    },
    [client],
  );

  const authenticateSkillMcpDependency = useCallback(
    async (skill: RuntimeSkillSummary, serverKey: string): Promise<RuntimeSkillDetail> => {
      const updated = await client.authenticateSkillMcpDependency(skill.id, serverKey);
      const [skillList, nextMcpState] = await Promise.all([
        client.listSkills(),
        client.listMcpServers(),
      ]);
      setSkills(skillList.skills);
      setMcpState(nextMcpState);
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

  const saveMcpServer = useCallback(
    async (input: RuntimeMcpServerInput) => {
      const next = await client.upsertMcpServer(input);
      setMcpState(next);
    },
    [client],
  );

  const fetchMcpServerTools = useCallback(
    async (input: RuntimeMcpServerInput): Promise<RuntimeMcpToolList> => (
      client.fetchMcpServerTools(input)
    ),
    [client],
  );

  const updateMcpServer = useCallback(
    async (
      server: RuntimeMcpServer,
      patch: Pick<RuntimeMcpServer, 'enabled'>,
    ) => {
      const next = await client.updateMcpServer(server.key, patch);
      setMcpState(next);
    },
    [client],
  );

  const deleteMcpServer = useCallback(
    async (server: RuntimeMcpServer) => {
      await client.deleteMcpServer(server.key);
      const next = await client.listMcpServers();
      setMcpState(next);
    },
    [client],
  );

  const loginMcpServer = useCallback(async (server: RuntimeMcpServer) => {
    setMcpState(await client.loginMcpServer(server.key));
  }, [client]);

  const logoutMcpServer = useCallback(async (server: RuntimeMcpServer) => {
    setMcpState(await client.logoutMcpServer(server.key));
  }, [client]);

  // Plugin bundle mutations may add/remove Skills, MCP servers, Hooks, and Hook config.
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
    deleteMcpServer,
    deleteSkill,
    fetchMcpServerTools,
    getSkillDetail,
    hookState,
    ...hookManagement,
    installSkillMcpDependencies,
    loginMcpServer,
    logoutMcpServer,
    mcpState,
    refreshCapabilities,
    refreshCapabilityDependencies,
    saveMcpServer,
    setSkillExtraRoots,
    skillExtraRoots,
    skills,
    updateMcpServer,
    updateSkill,
  };
}
