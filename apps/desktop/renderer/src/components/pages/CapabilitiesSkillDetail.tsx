import { Boxes, Check, FileText, Pencil, RefreshCw, Trash2 } from 'lucide-react';
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
}: {
  detail: RuntimeSkillDetail | null;
  error: string | null;
  loading: boolean;
  summary: RuntimeSkillSummary;
  onBack: () => void;
  onDelete?: (skill: RuntimeSkillSummary) => void;
  onEdit?: () => void;
  onUpdateSkill: (skill: RuntimeSkillSummary, patch: Partial<Pick<RuntimeSkillSummary, 'enabled' | 'selected'>>) => Promise<void>;
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
