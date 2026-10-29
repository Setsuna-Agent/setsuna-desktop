import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirm } from '@setsuna-desktop/renderer-ui';
import type { RuntimeSkillDetail, RuntimeSkillInput, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import type { CapabilitiesRefreshCoordinator } from '@setsuna-desktop/renderer-contracts/capabilities';
import type { SkillsRendererHost, SkillsRendererService } from '../contracts/index.js';
import type { SkillsTranslate } from './messages.js';
import type { CapabilitiesPageNavigation } from '@setsuna-desktop/renderer-contracts/settings';

type SkillPageMode = 'catalog' | 'create' | 'detail' | 'edit';
type SkillAction = 'save' | 'toggle' | 'delete' | 'install' | 'refresh' | 'reveal';

export function useSkillPageActions(service: SkillsRendererService, capabilitiesRefresh: CapabilitiesRefreshCoordinator, translate: SkillsTranslate, host: SkillsRendererHost, navigation?: CapabilitiesPageNavigation) {
  const confirm = useConfirm();
  const [mode, setMode] = useState<SkillPageMode>('catalog');
  const [summary, setSummary] = useState<RuntimeSkillSummary | null>(null);
  const [detail, setDetail] = useState<RuntimeSkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<ReadonlyMap<string, SkillAction>>(new Map());
  const pendingRef = useRef(new Map<string, SkillAction>());
  const viewVersion = useRef(0);
  const restoredItem = useRef<string | null>(null);
  const setActiveItemId = navigation?.setActiveItemId;
  useEffect(() => () => { viewVersion.current += 1; }, []);

  const navigate = useCallback((next: SkillPageMode) => {
    viewVersion.current += 1;
    setMode(next);
    setError(null);
    setOperationError(null);
    setLoading(false);
  }, []);
  const closeDetail = useCallback(() => {
    navigate('catalog');
    setSummary(null);
    setDetail(null);
    restoredItem.current = null;
    setActiveItemId?.(null);
  }, [navigate, setActiveItemId]);
  const openSkill = useCallback(async (skill: RuntimeSkillSummary) => {
    restoredItem.current = skill.id;
    setActiveItemId?.(skill.id);
    navigate('detail');
    const view = viewVersion.current;
    setSummary(skill);
    setDetail(null);
    setLoading(true);
    try {
      const loaded = await service.getSkill(skill.id);
      if (view !== viewVersion.current) return;
      setSummary(loaded);
      setDetail(loaded);
    } catch (cause) {
      if (view === viewVersion.current) setError(errorMessage(cause));
    } finally {
      if (view === viewVersion.current) setLoading(false);
    }
  }, [navigate, service, setActiveItemId]);
  const requestedItem = navigation?.activeItemId;
  const skills = service.getSnapshot().skills;
  useEffect(() => {
    if (requestedItem === undefined || requestedItem === restoredItem.current) return;
    if (!requestedItem) { closeDetail(); return; }
    const skill = skills.find((item) => item.id === requestedItem);
    if (skill) void openSkill(skill);
  }, [closeDetail, openSkill, requestedItem, skills]);

  const run = async <T,>(key: string, action: SkillAction, operation: () => Promise<T>, apply?: (result: T) => void) => {
    if (pendingRef.current.has(key)) return;
    const view = viewVersion.current;
    pendingRef.current.set(key, action);
    setPending(new Map(pendingRef.current));
    setOperationError(null);
    try {
      const result = await operation();
      // Services update the catalog; only the originating view may replace its detail or draft.
      if (view === viewVersion.current) apply?.(result);
    } catch (cause) {
      if (view === viewVersion.current) setOperationError(errorMessage(cause));
    } finally {
      pendingRef.current.delete(key);
      setPending(new Map(pendingRef.current));
    }
  };
  const refreshPluginCatalog = async (skill: RuntimeSkillSummary) => {
    if (skill.kind === 'plugin') await capabilitiesRefresh.refresh(['plugin-management']);
  };
  const toggleSkill = (skill: RuntimeSkillSummary, enabled: boolean) => run(skill.id, 'toggle', async () => {
    const updated = await service.updateSkill(skill.id, { enabled });
    await refreshPluginCatalog(skill);
    return updated;
  }, (updated) => {
    if (summary?.id === updated.id) { setSummary(updated); setDetail(updated); }
  });
  const showSaved = (saved: RuntimeSkillDetail) => {
    restoredItem.current = saved.id;
    setActiveItemId?.(saved.id);
    setSummary(saved);
    setDetail(saved);
    setMode('detail');
  };
  const saveSkill = async (input: RuntimeSkillInput) => {
    if (mode === 'create') {
      await run('$create', 'save', () => service.createSkill(input), showSaved);
    } else if (summary) {
      await run(summary.id, 'save', async () => {
        const { id: _id, ...patch } = input;
        const saved = await service.updateSkill(summary.id, patch);
        await refreshPluginCatalog(summary);
        return saved;
      }, showSaved);
    }
  };
  const deleteSkill = async (skill: RuntimeSkillSummary) => {
    const view = viewVersion.current;
    if (!await confirm({ title: translate('feature.skills.confirmDelete', { name: skill.name }), confirmLabel: translate('feature.skills.delete'), danger: true })) return;
    if (view !== viewVersion.current) return;
    await run(skill.id, 'delete', async () => {
      await service.deleteSkill(skill.id);
      await refreshPluginCatalog(skill);
    }, closeDetail);
  };
  const installDependencies = (skill: RuntimeSkillSummary) => run(skill.id, 'install', async () => {
    const result = await service.installMcpDependencies(skill.id);
    await capabilitiesRefresh.refresh(['mcp']);
    return result.skill;
  }, (updated) => { setSummary(updated); setDetail(updated); });

  return {
    mode, summary, detail, error, operationError, loading, pending,
    saving: pending.get(mode === 'create' ? '$create' : summary?.id ?? '') === 'save',
    refreshing: pending.has('$catalog'),
    closeDetail, openSkill, toggleSkill, saveSkill, deleteSkill, installDependencies,
    revealFile: ({ id, path }: RuntimeSkillDetail) => path
      ? run(id, 'reveal', () => host.revealFile(path))
      : Promise.resolve(),
    refresh: () => run('$catalog', 'refresh', () => service.refresh()),
    openCreate: () => { navigate('create'); setSummary(null); setDetail(null); },
    openEditor: () => { if (detail) navigate('edit'); },
    closeEditor: () => detail ? navigate('detail') : closeDetail(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
