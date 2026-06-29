import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { RuntimeSkillDetail, RuntimeSkillInput } from '@setsuna-desktop/contracts';
import { Button, PageHeader, TextArea, TextField } from '../primitives.js';

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
  const setEnabled = (enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      enabled,
      selected: enabled ? current.selected : false,
    }));
  };
  return (
    <section className="desktop-capabilities-detail desktop-capabilities-skill-editor">
      <PageHeader
        onBack={onBack}
        title={creating ? '新建 Skill' : skill?.name || '编辑 Skill'}
        subtitle={creating ? '保存到本地 user-skills，不请求外部接口。' : '只支持编辑本地个人 Skill。'}
        actions={
          <Button
            type="button"
            variant="primary"
            icon={<Save size={14} />}
            disabled={saving || !draft.name.trim() || !draft.content.trim()}
            onClick={() => void onSave(toInput(draft, creating))}
          >
            {saving ? '保存中' : '保存'}
          </Button>
        }
      />

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
          <label className="sd-check" title="启用后可在对话中选择这个 Skill">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />
            <span>启用</span>
          </label>
          <label className="sd-check" title="默认使用会把该 Skill 的 SKILL.md 正文自动加入每轮对话上下文">
            <input type="checkbox" checked={draft.selected} disabled={!draft.enabled} onChange={(event) => setDraftField(setDraft, 'selected', event.currentTarget.checked)} />
            <span>默认使用</span>
          </label>
        </div>
        <p className="desktop-capabilities-skill-usage-help desktop-capabilities-skill-form__full">
          默认使用会在每轮对话自动注入这个 Skill 的 SKILL.md 正文；只建议给常用且内容较短的 Skill 开启。手动词槽只影响当前这次发送。
        </p>
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
