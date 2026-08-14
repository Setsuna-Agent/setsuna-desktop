import type { RuntimeSkillDetail, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Dropdown, type MenuProps } from 'antd';
import { FileText, Loader2, LogIn, MessageSquare, MoreHorizontal, Pencil, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { Button, EmptyState, IconButton, PageHeader } from '../../shared/ui/primitives.js';
import { CapabilitiesPluginFilePreview } from './CapabilitiesPluginItemDialog.js';

export function CapabilitiesSkillDetail({
  detail,
  error,
  loading,
  summary,
  onBack,
  onDelete,
  onEdit,
  onUseInConversation,
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
  onUseInConversation: (skillId: string) => void;
  onUpdateSkill: (skill: RuntimeSkillSummary, patch: Pick<RuntimeSkillSummary, 'enabled'>) => Promise<void>;
  onInstallMcpDependencies: (skill: RuntimeSkillSummary) => Promise<void>;
  onAuthenticateMcpDependency: (skill: RuntimeSkillSummary, serverKey: string) => Promise<void>;
  pendingDependencyKeys: Set<string>;
}) {
  const { t } = useI18n();
  const activeSkill = detail ?? summary;
  const updateEnabled = (enabled: boolean) => {
    void onUpdateSkill(activeSkill, { enabled });
  };
  const actionItems: MenuProps['items'] = [
    ...(activeSkill.kind !== 'builtin' ? [
      {
        key: 'edit',
        icon: <Pencil size={14} />,
        label: t('capabilities.skill.edit'),
      },
      {
        key: 'delete',
        danger: true,
        icon: <Trash2 size={14} />,
        label: t('capabilities.skill.delete'),
      },
    ] : []),
    {
      key: 'use-in-conversation',
      disabled: !activeSkill.enabled,
      icon: <MessageSquare size={14} />,
      label: t('capabilities.skill.useInConversation'),
    },
  ];
  const handleActionClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    if (key === 'edit') onEdit?.();
    if (key === 'delete') onDelete?.(activeSkill);
    if (key === 'use-in-conversation') onUseInConversation(activeSkill.id);
  };
  return (
    <section className="desktop-capabilities-detail desktop-capabilities-skill-detail">
      <PageHeader
        onBack={onBack}
        title={activeSkill.name || t('capabilities.skill.detailFallback')}
        subtitle={t(skillKindLabel(activeSkill.kind))}
        actions={
          <>
            <label className="sd-check" title={t('capabilities.skill.enableHint')}>
              <input type="checkbox" checked={activeSkill.enabled} onChange={(event) => updateEnabled(event.currentTarget.checked)} />
              <span>{t('capabilities.skill.enabled')}</span>
            </label>
            <Dropdown
              destroyOnHidden
              menu={{ items: actionItems, onClick: handleActionClick }}
              placement="bottomRight"
              trigger={['click']}
            >
              <IconButton label={t('capabilities.skill.actions')}>
                <MoreHorizontal size={16} />
              </IconButton>
            </Dropdown>
          </>
        }
      />

      <div className="desktop-capabilities-skill-meta">
        <span>{activeSkill.id}</span>
        <span>{activeSkill.kind}</span>
        <span>{t('capabilities.skill.referenceCount', { count: detail?.references.length ?? 0 })}</span>
      </div>

      {activeSkill.description ? <p className="desktop-capabilities-skill-description">{activeSkill.description}</p> : null}

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
          <CapabilitiesPluginFilePreview
            file={{
              path: detail.path ?? 'SKILL.md',
              mimeType: 'text/markdown',
              size: new TextEncoder().encode(detail.content).byteLength,
              text: detail.content,
            }}
          />
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

function skillKindLabel(kind: RuntimeSkillSummary['kind']): 'capabilities.skill.personal' | 'capabilities.skill.plugin' | 'capabilities.skill.system' {
  const labels = {
    builtin: 'capabilities.skill.system',
    plugin: 'capabilities.skill.plugin',
    user: 'capabilities.skill.personal',
  } as const satisfies Record<RuntimeSkillSummary['kind'], string>;
  return labels[kind];
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
