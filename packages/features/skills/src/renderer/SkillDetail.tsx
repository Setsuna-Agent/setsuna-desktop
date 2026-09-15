import type { RuntimeSkillDetail, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import type { CapabilitiesPageNavigation, SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Switch } from '@setsuna-desktop/renderer-ui';
import { FileText, Loader2, LogIn, MessageSquare, Pencil, Plug, RefreshCw, Trash2 } from 'lucide-react';
import type { SkillsTranslate } from './messages.js';

export function SkillDetail({
  capabilities,
  detail,
  error,
  loading,
  onBack,
  onDelete,
  onEdit,
  onInstallDependencies,
  onToggle,
  onUseInChat,
  pendingDependencies,
  summary,
  translate,
  ui,
}: Readonly<{
  capabilities?: CapabilitiesPageNavigation;
  detail: RuntimeSkillDetail | null;
  error: string | null;
  loading: boolean;
  onBack(): void;
  onDelete?: () => Promise<void>;
  onEdit?: () => void;
  onInstallDependencies(): Promise<void>;
  onToggle(enabled: boolean): void;
  onUseInChat?: () => void;
  pendingDependencies: ReadonlySet<string>;
  summary: RuntimeSkillSummary;
  translate: SkillsTranslate;
  ui: SettingsViewUi;
}>) {
  const active = detail ?? summary;
  const actionItems = [
    ...(onEdit ? [{
      icon: <Pencil size={14} />,
      id: 'edit',
      label: translate('feature.skills.edit'),
    }] : []),
    ...(onDelete ? [{
      danger: true,
      icon: <Trash2 size={14} />,
      id: 'delete',
      label: translate('feature.skills.delete'),
    }] : []),
    {
      disabled: !active.enabled || !onUseInChat,
      icon: <MessageSquare size={14} />,
      id: 'use-in-conversation',
      label: translate('feature.skills.useInChat'),
    },
  ];
  return (
    <main className="capabilities-page desktop-capabilities-panel" data-feature-id="skills">
      <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
        {capabilities?.renderBreadcrumb({
          currentLabel: active.name,
          parentLabel: translate('feature.skills.title'),
          onBack,
        })}
        <section className="sd-detail desktop-capabilities-skill-detail">
          <ui.PageHeader
            className="sd-detail__header"
            leading={<ui.SkillIcon skill={active} variant="list" />}
            actions={(
              <>
                <span className="sd-toggle-label"><Switch label={translate('feature.skills.enableHint')} checked={active.enabled} onCheckedChange={(checked) => onToggle(checked)} /><span>{translate('feature.skills.enabled')}</span></span>
                <ui.ActionMenu
                  items={actionItems}
                  label={translate('feature.skills.actions')}
                  onSelect={(actionId) => {
                    if (actionId === 'edit') onEdit?.();
                    if (actionId === 'delete') void onDelete?.();
                    if (actionId === 'use-in-conversation') onUseInChat?.();
                  }}
                />
              </>
            )}
            subtitle={translate(skillSourceKey(active.kind))}
            title={active.name}
          />
          {active.description ? <p className="desktop-capabilities-skill-description">{active.description}</p> : null}
          <dl className="sd-detail__metadata">
            <div><dt>{translate('feature.skills.editor.id')}</dt><dd>{active.id}</dd></div>
            <div><dt>{translate('feature.skills.references')}</dt><dd>{detail ? translate('feature.skills.referenceCount', { count: detail.references.length }) : '—'}</dd></div>
          </dl>
          {loading ? <div className="desktop-capabilities-skill-loading"><RefreshCw className="is-spinning" size={14} />{translate('feature.skills.loading')}</div> : null}
          {error ? <ui.EmptyState title={translate('feature.skills.loadFailed')} body={error} /> : null}
          {detail?.mcpDependencies?.length ? (
            <section className="desktop-capabilities-skill-section">
              <header><Plug size={14} /><span>{translate('feature.skills.mcpDependencies')}</span></header>
              <div className="desktop-capabilities-skill-reference-list">
                {detail.mcpDependencies.map((dependency) => {
                  const installPending = pendingDependencies.has('install');
                  return (
                    <div className="desktop-capabilities-skill-dependency" key={dependency.value}>
                      <code>{dependency.value}</code>
                      <span>{translate(dependencyStatusKey(dependency.status))}</span>
                      {['missing', 'disabled', 'unchecked'].includes(dependency.status) ? (
                        <ui.Button disabled={installPending} icon={installPending ? <Loader2 className="is-spinning" size={14} /> : <Plug size={14} />} onClick={() => void onInstallDependencies()}>
                          {translate('feature.skills.installAndEnable')}
                        </ui.Button>
                      ) : ['authRequired', 'error'].includes(dependency.status) ? (
                        // The MCP page owns device-code interaction and authentication polling.
                        <ui.Button disabled={!capabilities?.openSection} icon={<LogIn size={14} />} onClick={() => capabilities?.openSection?.('mcp', dependency.value)}>
                          {translate('feature.skills.login')}
                        </ui.Button>
                      ) : null}
                      {dependency.error ? <small>{dependency.error}</small> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
          {detail?.dependencyErrors?.map((dependencyError) => (
            <div className="desktop-capabilities-skill-empty" key={dependencyError}>{dependencyError}</div>
          ))}
          {detail ? (
            <>
              <ui.MarkdownDocument key={detail.id} content={detail.content} name="SKILL.md"
                previewLabel={translate('feature.skills.preview')} sourceLabel={translate('feature.skills.source')} />
              <section className="desktop-capabilities-skill-section">
                <header><FileText size={14} /><span>{translate('feature.skills.references')}</span></header>
                {detail.references.length ? (
                  <div className="desktop-capabilities-skill-reference-list">{detail.references.map((reference) => <code key={reference}>{reference}</code>)}</div>
                ) : <div className="desktop-capabilities-skill-empty">{translate('feature.skills.noReferences')}</div>}
              </section>
            </>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function skillSourceKey(kind: RuntimeSkillSummary['kind']):
  | 'feature.skills.source.builtin'
  | 'feature.skills.source.plugin'
  | 'feature.skills.source.user' {
  return `feature.skills.source.${kind}`;
}

function dependencyStatusKey(status: NonNullable<RuntimeSkillDetail['mcpDependencies']>[number]['status']):
  | 'feature.skills.dependency.authRequired'
  | 'feature.skills.dependency.conflict'
  | 'feature.skills.dependency.disabled'
  | 'feature.skills.dependency.error'
  | 'feature.skills.dependency.missing'
  | 'feature.skills.dependency.pending'
  | 'feature.skills.dependency.ready' {
  if (status === 'ready') return 'feature.skills.dependency.ready';
  if (status === 'missing') return 'feature.skills.dependency.missing';
  if (status === 'disabled') return 'feature.skills.dependency.disabled';
  if (status === 'authRequired') return 'feature.skills.dependency.authRequired';
  if (status === 'conflict') return 'feature.skills.dependency.conflict';
  if (status === 'error') return 'feature.skills.dependency.error';
  return 'feature.skills.dependency.pending';
}
