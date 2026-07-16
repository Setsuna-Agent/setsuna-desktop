import { Boxes, Check, FileText, Loader2, LogIn, Pencil, Plug, RefreshCw, Trash2 } from 'lucide-react';
import type { RuntimeSkillDetail, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Button, EmptyState, PageHeader } from '../primitives.js';

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
        title={activeSkill.name || 'Skill 详情'}
        subtitle={activeSkill.kind === 'user' ? '个人 Skill' : '系统 Skill'}
        actions={
          <>
            <Button
              type="button"
              variant={selectedByDefault ? 'secondary' : 'primary'}
              icon={selectedByDefault ? <Check size={14} /> : <Boxes size={14} />}
              title="默认使用会把该 Skill 的 SKILL.md 正文自动加入每轮对话上下文"
              disabled={!activeSkill.enabled || selectedByDefault}
              onClick={() => void onUpdateSkill(activeSkill, { selected: true })}
            >
              {selectedByDefault ? '已默认使用' : '设为默认使用'}
            </Button>
            <label className="sd-check" title="启用后可在对话中选择这个 Skill">
              <input type="checkbox" checked={activeSkill.enabled} onChange={(event) => updateEnabled(event.currentTarget.checked)} />
              <span>启用</span>
            </label>
            {activeSkill.kind === 'user' ? (
              <>
                <Button type="button" variant="ghost" icon={<Pencil size={14} />} onClick={onEdit}>
                  编辑
                </Button>
                <Button type="button" variant="danger" icon={<Trash2 size={14} />} onClick={() => onDelete?.(activeSkill)}>
                  删除
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="desktop-capabilities-skill-meta">
        <span>{activeSkill.id}</span>
        <span>{activeSkill.kind}</span>
        <span>{detail?.references.length ?? 0} files</span>
      </div>

      {activeSkill.description ? <p className="desktop-capabilities-skill-description">{activeSkill.description}</p> : null}

      <p className="desktop-capabilities-skill-usage-help">
        默认使用会把该 Skill 的 SKILL.md 正文自动加入每轮对话上下文；对话输入框里的 Skill 词槽只影响当前这次发送。
      </p>

      {loading ? (
        <div className="desktop-capabilities-skill-loading">
          <RefreshCw className="is-spinning" size={14} />
          正在加载 Skill 详情
        </div>
      ) : null}

      {error ? <EmptyState title="Skill 详情加载失败" body={error} /> : null}

      {detail ? (
        <>
          {(detail.mcpDependencies?.length || detail.dependencyErrors?.length) ? (
            <section className="desktop-capabilities-skill-section">
              <header>
                <Plug size={14} />
                <span>MCP 依赖</span>
              </header>
              {detail.mcpDependencies?.length ? (
                <div className="desktop-capabilities-skill-reference-list">
                  {detail.mcpDependencies.map((dependency) => {
                    const installPending = pendingDependencyKeys.has(`install:${detail.id}`);
                    const authPending = pendingDependencyKeys.has(`auth:${detail.id}:${dependency.value}`);
                    return (
                      <div className="desktop-capabilities-skill-dependency" key={dependency.value}>
                        <code>{dependency.value}</code>
                        <span>{skillDependencyStatusLabel(dependency.status)}</span>
                        {(dependency.status === 'missing' || dependency.status === 'disabled' || dependency.status === 'unchecked') ? (
                          <Button type="button" variant="secondary" icon={installPending ? <Loader2 className="is-spinning" size={14} /> : <Plug size={14} />} disabled={installPending} onClick={() => void onInstallMcpDependencies(detail)}>
                            {installPending ? '处理中' : '安装并启用'}
                          </Button>
                        ) : dependency.status === 'authRequired' || dependency.status === 'error' ? (
                          <Button type="button" variant="secondary" icon={authPending ? <Loader2 className="is-spinning" size={14} /> : <LogIn size={14} />} disabled={authPending} onClick={() => void onAuthenticateMcpDependency(detail, dependency.value)}>
                            {authPending ? '等待授权' : '登录'}
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
            <pre className="desktop-capabilities-skill-content">{detail.content || 'No content'}</pre>
          </section>
          <section className="desktop-capabilities-skill-section">
            <header>
              <FileText size={14} />
              <span>资料文件</span>
            </header>
            {detail.references.length ? (
              <div className="desktop-capabilities-skill-reference-list">
                {detail.references.map((reference) => (
                  <code key={reference}>{reference}</code>
                ))}
              </div>
            ) : (
              <div className="desktop-capabilities-skill-empty">暂无资料文件</div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function skillDependencyStatusLabel(status: NonNullable<RuntimeSkillDetail['mcpDependencies']>[number]['status']): string {
  if (status === 'ready') return '已就绪';
  if (status === 'missing') return '未安装';
  if (status === 'disabled') return '已停用';
  if (status === 'authRequired') return '需要登录';
  if (status === 'conflict') return '配置冲突';
  if (status === 'error') return '连接或登录失败';
  return '待检查';
}
