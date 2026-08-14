import type {
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import { useCallback, useState } from 'react';
import { useIdentityRequestGuard } from '../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export type CapabilitySkillPageMode = 'view' | 'edit' | 'create' | null;

type CapabilitySkillDetailsOptions = {
  onCreateSkill: (input: RuntimeSkillInput) => Promise<RuntimeSkillDetail>;
  onDeleteSkill: (skill: RuntimeSkillSummary) => Promise<void>;
  onGetSkillDetail: (skillId: string) => Promise<RuntimeSkillDetail>;
  onUpdateSkill: (
    skill: RuntimeSkillSummary,
    patch: Partial<RuntimeSkillInput>,
  ) => Promise<RuntimeSkillDetail>;
};

export function useCapabilitySkillDetails({
  onCreateSkill,
  onDeleteSkill,
  onGetSkillDetail,
  onUpdateSkill,
}: CapabilitySkillDetailsOptions) {
  const { t } = useI18n();
  const [mode, setMode] = useState<CapabilitySkillPageMode>(null);
  const [summary, setSummary] = useState<RuntimeSkillSummary | null>(null);
  const [detail, setDetail] = useState<RuntimeSkillDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDependencyKeys, setPendingDependencyKeys] = useState<Set<string>>(new Set());
  const requestIdentity = summary?.id ?? (mode === 'create' ? 'new-skill' : 'no-selected-skill');
  const detailRequests = useIdentityRequestGuard(requestIdentity);
  const mutationRequests = useIdentityRequestGuard(requestIdentity);

  const updateIdentity = useCallback((identity: string) => {
    detailRequests.updateIdentity(identity);
    mutationRequests.updateIdentity(identity);
  }, [detailRequests, mutationRequests]);

  const close = useCallback(() => {
    updateIdentity('no-selected-skill');
    setSummary(null);
    setDetail(null);
    setError(null);
    setLoading(false);
    setSaving(false);
    setMode(null);
  }, [updateIdentity]);

  const openCreate = useCallback(() => {
    updateIdentity('new-skill');
    setMode('create');
    setSummary(null);
    setDetail(null);
    setError(null);
  }, [updateIdentity]);

  const open = useCallback(async (
    skill: RuntimeSkillSummary,
    nextMode: Exclude<CapabilitySkillPageMode, 'create' | null> = 'view',
  ) => {
    updateIdentity(skill.id);
    const isCurrentRequest = detailRequests.begin();
    setMode(nextMode);
    setSummary(skill);
    setDetail(null);
    setError(null);
    setLoading(true);
    try {
      const nextDetail = await onGetSkillDetail(skill.id);
      if (!isCurrentRequest()) return;
      setDetail(nextDetail);
      setSummary(nextDetail);
    } catch (unknownError) {
      if (!isCurrentRequest()) return;
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [detailRequests, onGetSkillDetail, updateIdentity]);

  const updateFromDetail = useCallback(async (
    skill: RuntimeSkillSummary,
    patch: Pick<RuntimeSkillSummary, 'enabled'>,
  ) => {
    const isCurrentRequest = mutationRequests.begin();
    const updated = await onUpdateSkill(skill, patch);
    if (!isCurrentRequest()) return;
    setSummary(updated);
    setDetail(updated);
  }, [mutationRequests, onUpdateSkill]);

  const save = useCallback(async (input: RuntimeSkillInput) => {
    const isCurrentRequest = mutationRequests.begin();
    setSaving(true);
    try {
      const saved = mode === 'create'
        ? await onCreateSkill(input)
        : summary
          ? await onUpdateSkill(summary, input)
          : null;
      if (!saved || !isCurrentRequest()) return;
      setSaving(false);
      updateIdentity(saved.id);
      setSummary(saved);
      setDetail(saved);
      setMode('view');
    } finally {
      if (isCurrentRequest()) setSaving(false);
    }
  }, [mode, mutationRequests, onCreateSkill, onUpdateSkill, summary, updateIdentity]);

  const remove = useCallback(async (skill: RuntimeSkillSummary) => {
    const confirmed = window.confirm(t('capabilities.page.confirmDeleteSkill', { name: skill.name }));
    if (!confirmed) return;
    const isCurrentRequest = mutationRequests.begin();
    await onDeleteSkill(skill);
    if (isCurrentRequest()) close();
  }, [close, mutationRequests, onDeleteSkill, t]);

  const updateDependency = useCallback(async (
    skill: RuntimeSkillSummary,
    key: string,
    action: () => Promise<RuntimeSkillDetail>,
  ) => {
    const isCurrentRequest = mutationRequests.begin();
    setPendingDependencyKeys((items) => new Set(items).add(key));
    try {
      const updated = await action();
      if (isCurrentRequest() && summary?.id === updated.id) {
        setSummary(updated);
        setDetail(updated);
      }
    } finally {
      setPendingDependencyKeys((items) => {
        const next = new Set(items);
        next.delete(key);
        return next;
      });
    }
  }, [mutationRequests, summary?.id]);

  const backFromEditor = useCallback(() => {
    if (summary) setMode('view');
    else close();
  }, [close, summary]);
  const openEditor = useCallback(() => setMode('edit'), []);

  return {
    backFromEditor,
    close,
    detail,
    error,
    loading,
    mode,
    open,
    openCreate,
    openEditor,
    pendingDependencyKeys,
    remove,
    save,
    saving,
    summary,
    updateDependency,
    updateFromDetail,
  };
}
