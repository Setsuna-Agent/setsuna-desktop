import { ArrowLeft, Boxes, Check, FileText, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import type { RuntimeSkillDetail, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Button, EmptyState } from '../primitives.js';

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
  return (
    <section className="desktop-capabilities-detail desktop-capabilities-skill-detail">
      <header className="desktop-capabilities-detail__head">
        <div>
          <Button type="button" variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack}>
            返回
          </Button>
          <h2>{activeSkill.name || 'Skill 详情'}</h2>
          <span className="desktop-capabilities-detail__subtitle">
            {activeSkill.kind === 'user' ? '个人 Skill' : '系统 Skill'} · {activeSkill.path ?? activeSkill.id}
          </span>
        </div>
        <div className="desktop-capabilities-skill-actions">
          <Button
            type="button"
            variant={activeSkill.selected ? 'secondary' : 'primary'}
            icon={activeSkill.selected ? <Check size={14} /> : <Boxes size={14} />}
            disabled={!activeSkill.enabled || activeSkill.selected}
            onClick={() => void onUpdateSkill(activeSkill, { selected: true })}
          >
            {activeSkill.selected ? '已使用' : '使用'}
          </Button>
          <label className="sd-check">
            <input type="checkbox" checked={activeSkill.enabled} onChange={(event) => void onUpdateSkill(activeSkill, { enabled: event.currentTarget.checked })} />
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
        </div>
      </header>

      <div className="desktop-capabilities-skill-meta">
        <span>{activeSkill.id}</span>
        <span>{activeSkill.kind}</span>
        <span>{detail?.references.length ?? 0} files</span>
      </div>

      {activeSkill.description ? <p className="desktop-capabilities-skill-description">{activeSkill.description}</p> : null}

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
