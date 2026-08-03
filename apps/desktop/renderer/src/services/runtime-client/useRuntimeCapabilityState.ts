import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimeHookInput,
  RuntimeHookListResponse,
  RuntimeHookMetadata,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpToolList,
  RuntimePluginInstallResult,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginList,
  RuntimePluginMarketplaceItem,
  RuntimePluginMarketplaceList,
  RuntimePluginSummary,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillList,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteHookFromConfig,
  hookConfigLocation,
  hookInputToMatcherGroup,
  updateHookInConfig,
} from '../../features/capabilities/hooks/runtimeHookConfig.js';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';
import { reportRuntimeBackgroundFailure } from './runtimeClientErrors.js';

export type RuntimeCapabilityBootstrapResults = {
  skillResult: PromiseSettledResult<RuntimeSkillList>;
  mcpResult: PromiseSettledResult<RuntimeMcpServerList>;
  pluginResult: PromiseSettledResult<RuntimePluginList>;
  pluginMarketplaceResult: PromiseSettledResult<RuntimePluginMarketplaceList>;
};

export type RuntimeCapabilityBootstrapValues = {
  skills?: RuntimeSkillSummary[];
  mcpState?: RuntimeMcpServerList;
  plugins?: RuntimePluginSummary[];
  pluginMarketplace?: RuntimePluginMarketplaceItem[];
  pluginMarketplaceErrors?: string[];
};

export type RuntimeCapabilityClient = Pick<
  DesktopRuntimeClient,
  | 'authenticateSkillMcpDependency'
  | 'createSkill'
  | 'deleteMcpServer'
  | 'deleteSkill'
  | 'fetchMcpServerTools'
  | 'getConfig'
  | 'getMarketplacePluginItemContent'
  | 'getPluginItemContent'
  | 'getSkill'
  | 'installMarketplacePlugin'
  | 'installSkillMcpDependencies'
  | 'listHooks'
  | 'listMcpServers'
  | 'listPluginMarketplace'
  | 'listPlugins'
  | 'listSkills'
  | 'loginMcpServer'
  | 'logoutMcpServer'
  | 'removePlugin'
  | 'saveConfig'
  | 'setSkillExtraRoots'
  | 'updateMarketplacePlugin'
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
  if (results.pluginResult.status === 'fulfilled') {
    values.plugins = results.pluginResult.value.plugins;
  }
  if (results.pluginMarketplaceResult.status === 'fulfilled') {
    values.pluginMarketplace = results.pluginMarketplaceResult.value.plugins;
    values.pluginMarketplaceErrors = results.pluginMarketplaceResult.value.errors;
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

/**
 * Owns renderer state and commands for Skill, MCP, Hook, and Plugin capabilities.
 *
 * Runtime config remains owned by `useRuntimeConfigState` because Hook mutations share
 * the same persisted config document as model and runtime preferences.
 */
export function useRuntimeCapabilityState({
  activeProjectPath,
  client,
  config,
  enabled,
  onConfigChange,
}: RuntimeCapabilityStateOptions) {
  const [skills, setSkills] = useState<RuntimeSkillSummary[]>([]);
  const [skillExtraRoots, setSkillExtraRootsState] = useState<string[]>([]);
  const [mcpState, setMcpState] = useState<RuntimeMcpServerList | null>(null);
  const [hookState, setHookState] = useState<RuntimeHookListResponse | null>(null);
  const [plugins, setPlugins] = useState<RuntimePluginSummary[]>([]);
  const [pluginMarketplace, setPluginMarketplace] = useState<RuntimePluginMarketplaceItem[]>([]);
  const [pluginMarketplaceErrors, setPluginMarketplaceErrors] = useState<string[]>([]);
  const capabilityRequests = useLatestRequestGuard();
  const activeHookCwds = useMemo(
    () => (activeProjectPath ? [activeProjectPath] : []),
    [activeProjectPath],
  );

  const applyBootstrapResults = useCallback((results: RuntimeCapabilityBootstrapResults) => {
    const values = capabilityBootstrapValues(results);
    if (values.skills) setSkills(values.skills);
    if (values.mcpState) setMcpState(values.mcpState);
    if (values.plugins) setPlugins(values.plugins);
    if (values.pluginMarketplace) setPluginMarketplace(values.pluginMarketplace);
    if (values.pluginMarketplaceErrors) {
      setPluginMarketplaceErrors(values.pluginMarketplaceErrors);
    }
  }, []);

  const refreshCapabilities = useCallback(async () => {
    const isLatestRequest = capabilityRequests.begin();
    const results = await Promise.allSettled([
      client.listSkills(),
      client.listMcpServers(),
      client.listHooks(activeHookCwds),
      client.listPlugins(),
      client.listPluginMarketplace(),
    ]);
    const [skillResult, mcpResult, hookResult, pluginResult, pluginMarketplaceResult] = results;
    if (isLatestRequest()) {
      if (skillResult.status === 'fulfilled') setSkills(skillResult.value.skills);
      if (mcpResult.status === 'fulfilled') setMcpState(mcpResult.value);
      if (hookResult.status === 'fulfilled') setHookState(hookResult.value);
      if (pluginResult.status === 'fulfilled') setPlugins(pluginResult.value.plugins);
      if (pluginMarketplaceResult.status === 'fulfilled') {
        setPluginMarketplace(pluginMarketplaceResult.value.plugins);
        setPluginMarketplaceErrors(pluginMarketplaceResult.value.errors);
      }
    }
    reportOptionalRuntimeLoadFailures([
      ['skills', skillResult],
      ['MCP', mcpResult],
      ['hooks', hookResult],
      ['plugins', pluginResult],
      ['plugin marketplace', pluginMarketplaceResult],
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
      return updated;
    },
    [client],
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
    },
    [client],
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
      patch: Partial<Pick<RuntimeMcpServer, 'enabled' | 'required' | 'requireApproval'>>,
    ) => {
      const next = await client.updateMcpServer(server.key, patch);
      setMcpState(next);
    },
    [client],
  );

  const updateHookState = useCallback(
    async (hook: RuntimeHookMetadata, patch: { enabled?: boolean; trustedHash?: string }) => {
      if (!config) return;
      const currentHooks = config.hooks ?? {};
      const currentState = currentHooks.state ?? {};
      const currentHookState = currentState[hook.key] ?? {};
      const next = await client.saveConfig({
        hooks: {
          ...currentHooks,
          state: {
            ...currentState,
            [hook.key]: {
              ...currentHookState,
              ...patch,
            },
          },
        },
      });
      onConfigChange(next);
      await refreshHooks();
    },
    [client, config, onConfigChange, refreshHooks],
  );

  const trustHook = useCallback(
    async (hook: RuntimeHookMetadata) => updateHookState(
      hook,
      { trustedHash: hook.currentHash },
    ),
    [updateHookState],
  );

  const updateHookEnabled = useCallback(
    async (hook: RuntimeHookMetadata, hookEnabled: boolean) => (
      updateHookState(hook, { enabled: hookEnabled })
    ),
    [updateHookState],
  );

  const createHook = useCallback(
    async (input: RuntimeHookInput) => {
      if (!config) throw new Error('Runtime config is not loaded.');
      const command = input.command.trim();
      if (!command) throw new Error('Hook command is required.');
      const currentHooks = config.hooks ?? {};
      const groups = currentHooks[input.eventName] ?? [];
      const next = await client.saveConfig({
        hooks: {
          ...currentHooks,
          [input.eventName]: [
            ...groups,
            hookInputToMatcherGroup({ ...input, command }),
          ],
        },
      });
      onConfigChange(next);
      await refreshHooks();
    },
    [client, config, onConfigChange, refreshHooks],
  );

  const updateHook = useCallback(
    async (hook: RuntimeHookMetadata, input: RuntimeHookInput) => {
      if (!config) throw new Error('Runtime config is not loaded.');
      const command = input.command.trim();
      if (!command) throw new Error('Hook command is required.');
      const currentHooks = config.hooks ?? {};
      const location = hookConfigLocation(hook);
      if (!location) throw new Error('Hook location is invalid.');
      const nextHooks = updateHookInConfig(currentHooks, location, { ...input, command });
      const next = await client.saveConfig({ hooks: nextHooks });
      onConfigChange(next);
      await refreshHooks();
    },
    [client, config, onConfigChange, refreshHooks],
  );

  const deleteHook = useCallback(
    async (hook: RuntimeHookMetadata) => {
      if (!config) throw new Error('Runtime config is not loaded.');
      const currentHooks = config.hooks ?? {};
      const location = hookConfigLocation(hook);
      if (!location) throw new Error('Hook location is invalid.');
      const nextHooks = deleteHookFromConfig(currentHooks, location);
      const next = await client.saveConfig({ hooks: nextHooks });
      onConfigChange(next);
      await refreshHooks();
    },
    [client, config, onConfigChange, refreshHooks],
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

  const refreshPluginCapabilities = useCallback(async () => {
    const [pluginList, marketplace, skillList, nextMcpState, nextConfig, nextHookState] = (
      await Promise.all([
        client.listPlugins(),
        client.listPluginMarketplace(),
        client.listSkills(),
        client.listMcpServers(),
        client.getConfig(),
        client.listHooks(activeHookCwds),
      ])
    );
    setPlugins(pluginList.plugins);
    setPluginMarketplace(marketplace.plugins);
    setPluginMarketplaceErrors(marketplace.errors);
    setSkills(skillList.skills);
    setMcpState(nextMcpState);
    onConfigChange(nextConfig);
    setHookState(nextHookState);
  }, [activeHookCwds, client, onConfigChange]);

  const getPluginItemContent = useCallback((
    pluginId: string,
    kind: RuntimePluginItemKind,
    itemId: string,
    source: 'installed' | 'marketplace',
  ): Promise<RuntimePluginItemContent> => (
    source === 'installed'
      ? client.getPluginItemContent(pluginId, kind, itemId)
      : client.getMarketplacePluginItemContent(pluginId, kind, itemId)
  ), [client]);

  const installMarketplacePlugin = useCallback(
    async (pluginId: string): Promise<RuntimePluginInstallResult> => {
      const result = await client.installMarketplacePlugin(pluginId);
      await refreshPluginCapabilities();
      return result;
    },
    [client, refreshPluginCapabilities],
  );

  const updateMarketplacePlugin = useCallback(
    async (pluginId: string): Promise<RuntimePluginInstallResult> => {
      const result = await client.updateMarketplacePlugin(pluginId);
      await refreshPluginCapabilities();
      return result;
    },
    [client, refreshPluginCapabilities],
  );

  const removePlugin = useCallback(async (pluginId: string): Promise<void> => {
    await client.removePlugin(pluginId);
    await refreshPluginCapabilities();
  }, [client, refreshPluginCapabilities]);

  return {
    applyBootstrapResults,
    authenticateSkillMcpDependency,
    createHook,
    createSkill,
    deleteHook,
    deleteMcpServer,
    deleteSkill,
    fetchMcpServerTools,
    getPluginItemContent,
    getSkillDetail,
    hookState,
    installMarketplacePlugin,
    installSkillMcpDependencies,
    loginMcpServer,
    logoutMcpServer,
    mcpState,
    pluginMarketplace,
    pluginMarketplaceErrors,
    plugins,
    refreshCapabilities,
    refreshHooks,
    removePlugin,
    saveMcpServer,
    setSkillExtraRoots,
    skillExtraRoots,
    skills,
    trustHook,
    updateHook,
    updateHookEnabled,
    updateMarketplacePlugin,
    updateMcpServer,
    updateSkill,
  };
}
