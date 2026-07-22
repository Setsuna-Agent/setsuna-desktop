import type { RuntimeSkillDetail, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Boxes, Check, FileText, Loader2, LogIn, Pencil, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { Button, EmptyState, PageHeader } from '../../shared/ui/primitives.js';

export function CapabilitiesSkillDetail({
  detail,
  error,
  loading,
  summary,
  onBack,
  onDelete,
  onEdit,
  onUpdateSkill,
  onInstallMcpDependencies,
  onAuthenticateMcpDependency,
  pendingDependencyKeys,
}: {
  detail: RuntimeSkillDetail | null;
  error: string | null;
  loading: boolean;
  summary: RuntimeSkillSummary;
  onBack: () => void;
  onDelete?: (skill: RuntimeSkillSummary) => void;
  onEdit?: () => void;
  onUpdateSkill: (skill: RuntimeSkillSummary, patch: Partial<Pick<RuntimeSkillSummary, 'enabled' | 'selected'>>) => Promise<void>;
  onInstallMcpDependencies: (skill: RuntimeSkillSummary) => Promise<void>;
  onAuthenticateMcpDependency: (skill: RuntimeSkillSummary, serverKey: string) => Promise<void>;
  pendingDependencyKeys: Set<string>;
}) {
  const { t } = useI18n();
  const activeSkill = detail ?? summary;
  const selectedByDefault = activeSkill.enabled && activeSkill.selected;
  const updateEnabled = (enabled: boolean) => {
    void onUpdateSkill(activeSkill, {
      enabled,
      ...(enabled ? {} : { selected: false }),
    });
  };
  return (
    <section className="desktop-capabilities-detail desktop-capabilities-skill-detail">
      <PageHeader
        onBack={onBack}
        title={activeSkill.name || t('capabilities.skill.detailFallback')}
        subtitle={t(activeSkill.kind === 'user' ? 'capabilities.skill.personal' : 'capabilities.skill.system')}
        actions={
          <>
            <Button
              type="button"
              variant={selectedByDefault ? 'secondary' : 'primary'}
              icon={selectedByDefault ? <Check size={14} /> : <Boxes size={14} />}
              title={t('capabilities.skill.defaultHint')}
              disabled={!activeSkill.enabled || selectedByDefault}
              onClick={() => void onUpdateSkill(activeSkill, { selected: true })}
            >
              {t(selectedByDefault ? 'capabilities.skill.defaultActive' : 'capabilities.skill.setDefault')}
            </Button>
            <label className="sd-check" title={t('capabilities.skill.enableHint')}>
              <input type="checkbox" checked={activeSkill.enabled} onChange={(event) => updateEnabled(event.currentTarget.checked)} />
              <span>{t('capabilities.skill.enabled')}</span>
            </label>
            {activeSkill.kind === 'user' ? (
              <>
                <Button type="button" variant="ghost" icon={<Pencil size={14} />} onClick={onEdit}>
                  {t('capabilities.skill.edit')}
                </Button>
                <Button type="button" variant="danger" icon={<Trash2 size={14} />} onClick={() => onDelete?.(activeSkill)}>
                  {t('capabilities.skill.delete')}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="desktop-capabilities-skill-meta">
        <span>{activeSkill.id}</span>
        <span>{activeSkill.kind}</span>
        <span>{t('capabilities.skill.referenceCount', { count: detail?.references.length ?? 0 })}</span>
      </div>

      {activeSkill.description ? <p className="desktop-capabilities-skill-description">{activeSkill.description}</p> : null}

      <p className="desktop-capabilities-skill-usage-help">
        {t('capabilities.skill.defaultDescription')}
      </p>

      {loading ? (
        <div className="desktop-capabilities-skill-loading">
          <RefreshCw className="is-spinning" size={14} />
          {t('capabilities.skill.loading')}
        </div>
      ) : null}

      {error ? <EmptyState title={t('capabilities.skill.loadFailed')} body={error} /> : null}

      {detail ? (
        <>
          {(detail.mcpDependencies?.length || detail.dependencyErrors?.length) ? (
            <section className="desktop-capabilities-skill-section">
              <header>
                <Plug size={14} />
                <span>{t('capabilities.skill.mcpDependencies')}</span>
              </header>
              {detail.mcpDependencies?.length ? (
                <div className="desktop-capabilities-skill-reference-list">
                  {detail.mcpDependencies.map((dependency) => {
                    const installPending = pendingDependencyKeys.has(`install:${detail.id}`);
                    const authPending = pendingDependencyKeys.has(`auth:${detail.id}:${dependency.value}`);
                    return (
                      <div className="desktop-capabilities-skill-dependency" key={dependency.value}>
                        <code>{dependency.value}</code>
                        <span>{skillDependencyStatusLabel(dependency.status, t)}</span>
                        {(dependency.status === 'missing' || dependency.status === 'disabled' || dependency.status === 'unchecked') ? (
                          <Button type="button" variant="secondary" icon={installPending ? <Loader2 className="is-spinning" size={14} /> : <Plug size={14} />} disabled={installPending} onClick={() => void onInstallMcpDependencies(detail)}>
                            {installPending ? t('common.processing') : t('capabilities.skill.installAndEnable')}
                          </Button>
                        ) : dependency.status === 'authRequired' || dependency.status === 'error' ? (
                          <Button type="button" variant="secondary" icon={authPending ? <Loader2 className="is-spinning" size={14} /> : <LogIn size={14} />} disabled={authPending} onClick={() => void onAuthenticateMcpDependency(detail, dependency.value)}>
                            {t(authPending ? 'capabilities.skill.awaitingAuthorization' : 'capabilities.skill.login')}
                          </Button>
                        ) : null}
                        {dependency.error ? <small>{dependency.error}</small> : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {detail.dependencyErrors?.map((dependencyError) => (
                <div className="desktop-capabilities-skill-empty" key={dependencyError}>{dependencyError}</div>
              ))}
            </section>
          ) : null}
          <section className="desktop-capabilities-skill-section">
            <header>
              <FileText size={14} />
              <span>SKILL.md</span>
            </header>
            <pre className="desktop-capabilities-skill-content">{detail.content || t('capabilities.skill.noContent')}</pre>
          </section>
          <section className="desktop-capabilities-skill-section">
            <header>
              <FileText size={14} />
              <span>{t('capabilities.skill.referenceFiles')}</span>
            </header>
            {detail.references.length ? (
              <div className="desktop-capabilities-skill-reference-list">
                {detail.references.map((reference) => (
                  <code key={reference}>{reference}</code>
                ))}
              </div>
            ) : (
              <div className="desktop-capabilities-skill-empty">{t('capabilities.skill.noReferenceFiles')}</div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function skillDependencyStatusLabel(status: NonNullable<RuntimeSkillDetail['mcpDependencies']>[number]['status'], t: Translate): string {
  if (status === 'ready') return t('capabilities.skill.dependency.ready');
  if (status === 'missing') return t('capabilities.skill.dependency.missing');
  if (status === 'disabled') return t('capabilities.skill.dependency.disabled');
  if (status === 'authRequired') return t('capabilities.skill.dependency.authRequired');
  if (status === 'conflict') return t('capabilities.skill.dependency.conflict');
  if (status === 'error') return t('capabilities.skill.dependency.error');
  return t('capabilities.skill.dependency.pending');
}
