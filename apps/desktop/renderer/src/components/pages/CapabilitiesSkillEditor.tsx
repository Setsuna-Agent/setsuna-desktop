import { useEffect, useState } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import type { RuntimeSkillDetail, RuntimeSkillInput } from '@setsuna-desktop/contracts';
import { Button, TextArea, TextField } from '../primitives.js';

type SkillEditorDraft = {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  selected: boolean;
};

export function CapabilitiesSkillEditor({
  mode,
  saving,
  skill,
  onBack,
  onSave,
}: {
  mode: 'create' | 'edit';
  saving: boolean;
  skill?: RuntimeSkillDetail | null;
  onBack: () => void;
  onSave: (input: RuntimeSkillInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SkillEditorDraft>(() => createDraft(skill));

  useEffect(() => {
    setDraft(createDraft(skill));
  }, [skill]);

  const creating = mode === 'create';
  return (
    <section className="desktop-capabilities-detail desktop-capabilities-skill-editor">
      <header className="desktop-capabilities-detail__head">
        <div>
          <Button type="button" variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack}>
            返回
          </Button>
          <h2>{creating ? '新建 Skill' : skill?.name || '编辑 Skill'}</h2>
          <span className="desktop-capabilities-detail__subtitle">
            {creating ? '保存到本地 user-skills，不请求外部接口。' : '只支持编辑本地个人 Skill。'}
          </span>
        </div>
        <Button
          type="button"
          variant="primary"
          icon={<Save size={14} />}
          disabled={saving || !draft.name.trim() || !draft.content.trim()}
          onClick={() => void onSave(toInput(draft, creating))}
        >
          {saving ? '保存中' : '保存'}
        </Button>
      </header>

      <div className="desktop-capabilities-skill-form">
        <label>
          <span>名称</span>
          <TextField value={draft.name} onChange={(event) => setDraftField(setDraft, 'name', event.target.value)} placeholder="Skill 名称" />
        </label>
        <label>
          <span>标识</span>
          <TextField
            value={draft.id}
            disabled={!creating}
            onChange={(event) => setDraftField(setDraft, 'id', event.target.value)}
            placeholder="留空则按名称生成"
          />
        </label>
        <label className="desktop-capabilities-skill-form__full">
          <span>简介</span>
          <TextArea value={draft.description} onChange={(event) => setDraftField(setDraft, 'description', event.target.value)} placeholder="一句话说明这个 Skill 适合做什么" />
        </label>
        <label className="desktop-capabilities-skill-form__full">
          <span>SKILL.md</span>
          <TextArea
            className="desktop-capabilities-skill-form__content"
            value={draft.content}
            onChange={(event) => setDraftField(setDraft, 'content', event.target.value)}
            placeholder="# Skill\n\n写下使用时机、工作流程和约束。"
            spellCheck={false}
          />
        </label>
        <div className="desktop-capabilities-skill-form__checks">
          <label className="sd-check">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraftField(setDraft, 'enabled', event.currentTarget.checked)} />
            <span>启用</span>
          </label>
          <label className="sd-check">
            <input type="checkbox" checked={draft.selected} disabled={!draft.enabled} onChange={(event) => setDraftField(setDraft, 'selected', event.currentTarget.checked)} />
            <span>立即使用</span>
          </label>
        </div>
      </div>
    </section>
  );
}

function createDraft(skill?: RuntimeSkillDetail | null): SkillEditorDraft {
  return {
    id: skill?.id ?? '',
    name: skill?.name ?? '',
    description: skill?.description ?? '',
    content: skill?.content ?? '',
    enabled: skill?.enabled ?? true,
    selected: skill?.selected ?? false,
  };
}

function toInput(draft: SkillEditorDraft, includeId: boolean): RuntimeSkillInput {
  return {
    ...(includeId && draft.id.trim() ? { id: draft.id.trim() } : {}),
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    content: draft.content.trim(),
    enabled: draft.enabled,
    selected: draft.enabled && draft.selected,
  };
}

function setDraftField<TKey extends keyof SkillEditorDraft>(
  setDraft: (updater: (draft: SkillEditorDraft) => SkillEditorDraft) => void,
  key: TKey,
  value: SkillEditorDraft[TKey],
) {
  setDraft((draft) => ({ ...draft, [key]: value }));
}
