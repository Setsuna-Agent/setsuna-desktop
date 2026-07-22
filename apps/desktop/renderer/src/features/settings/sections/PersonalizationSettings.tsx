import type {
  RuntimeConfigState,
  RuntimeMemoryPreview,
  RuntimeMemoryPreviewItem,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { Popconfirm } from 'antd';
import { ChevronRight, Cpu, Eye, FileText, FolderOpen, Pencil, RefreshCw, Sun, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  SelectField,
  TextArea,
  TextField,
} from '../../../shared/ui/primitives.js';
import { MemorySettingToggle, SettingsChoiceGroup, type SettingsChoiceOption } from '../components/SettingsControls.js';
import { memoryExtractModelOptions } from '../providers/provider-model.js';
import type { RuntimePreferenceInput } from '../settings-types.js';
import { errorMessage, formatSettingsDate } from '../settings-utils.js';

const PERSONALIZATION_PROMPT_MAX_LENGTH = 8000;
const PERSONALIZATION_PROMPT_SAVE_DELAY_MS = 360;
const setsunaStyleOptions: Array<SettingsChoiceOption<RuntimeConfigState['setsunaStyle']>> = [
  { value: 'developer', label: '开发', icon: <Cpu size={14} /> },
  { value: 'daily', label: '日常', icon: <Sun size={14} /> },
];

export function PersonalizationSettings({
  config,
  projects,
  memoryPreview,
  memoryPreviewLoading,
  onSavePreferences,
  onPreview,
  onDelete,
  onReset,
}: {
  config: RuntimeConfigState;
  projects: WorkspaceProject[];
  memoryPreview: RuntimeMemoryPreview | null;
  memoryPreviewLoading: boolean;
  onSavePreferences: (input: RuntimePreferenceInput) => Promise<void>;
  onPreview: () => Promise<RuntimeMemoryPreview>;
  onDelete: (memoryId: string) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [personalizationView, setPersonalizationView] = useState<'overview' | 'memoryPreview'>('overview');
  const [globalPromptDraft, setGlobalPromptDraft] = useState(config.globalPrompt);
  const [selectingStorage, setSelectingStorage] = useState(false);
  const [memoryDeletingId, setMemoryDeletingId] = useState<string | null>(null);
  const [memoryResetting, setMemoryResetting] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const globalPromptLength = Array.from(globalPromptDraft).length;
  const storagePath = config.storagePath || config.dataPath;

  useEffect(() => {
    setGlobalPromptDraft(config.globalPrompt);
  }, [config.globalPrompt]);

  useEffect(() => {
    if (globalPromptDraft === config.globalPrompt) return undefined;
    const timer = window.setTimeout(() => {
      void onSavePreferences({ globalPrompt: globalPromptDraft });
    }, PERSONALIZATION_PROMPT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [config.globalPrompt, globalPromptDraft, onSavePreferences]);

  const selectMemoryStoragePath = async () => {
    const api = window.setsunaDesktop?.desktop;
    if (!api?.selectDirectory) {
      setMemoryError('当前环境不支持选择目录。');
      return;
    }
    setSelectingStorage(true);
    setMemoryError(null);
    try {
      const selectedPath = await api.selectDirectory({ title: '选择记忆存储目录' });
      if (selectedPath) await onSavePreferences({ storagePath: selectedPath });
    } catch (unknownError) {
      setMemoryError(errorMessage(unknownError, '选择存储位置失败'));
    } finally {
      setSelectingStorage(false);
    }
  };

  const loadMemoryPreview = async () => {
    setMemoryError(null);
    try {
      return await onPreview();
    } catch (unknownError) {
      setMemoryError(errorMessage(unknownError, '记忆预览加载失败'));
      return null;
    }
  };

  const openMemoryPreview = async () => {
    setPersonalizationView('memoryPreview');
    await loadMemoryPreview();
  };

  const deleteMemoryItem = async (item: RuntimeMemoryPreviewItem) => {
    setMemoryDeletingId(item.id);
    setMemoryError(null);
    try {
      await onDelete(item.id);
    } catch (unknownError) {
      setMemoryError(errorMessage(unknownError, '删除记忆失败'));
    } finally {
      setMemoryDeletingId(null);
    }
  };

  const resetMemoryItems = async () => {
    setMemoryResetting(true);
    setMemoryError(null);
    try {
      await onReset();
    } catch (unknownError) {
      setMemoryError(errorMessage(unknownError, '重置记忆失败'));
    } finally {
      setMemoryResetting(false);
    }
  };

  if (personalizationView === 'memoryPreview') {
    const items = memoryPreview?.items ?? [];
    const previewStoragePath = memoryPreview?.storagePath || storagePath;

    return (
      <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__memory-preview-section">
        <PageHeader
          className="chat-user-settings__memory-preview-header"
          onBack={() => setPersonalizationView('overview')}
          title="记忆预览"
          actions={
            <Button className="chat-user-settings__tiny-action" icon={<RefreshCw size={14} />} disabled={memoryPreviewLoading || memoryResetting || Boolean(memoryDeletingId)} onClick={() => void loadMemoryPreview()}>
              {memoryPreviewLoading ? '刷新中' : '刷新'}
            </Button>
          }
        />
        <div className="chat-user-settings__memory-preview-summary">
          <div>
            <strong>{memoryPreview?.total ?? 0} 条记忆</strong>
            <span>包含主动沉淀和后台沉淀的长期偏好、规则、事实或流程</span>
          </div>
          <code title={previewStoragePath}>{previewStoragePath}</code>
        </div>
        {memoryError ? <div className="chat-user-settings__memory-error">{memoryError}</div> : null}
        <div className="chat-user-settings__memory-list" aria-busy={memoryPreviewLoading}>
          {items.length ? (
            items.map((item) => {
              const meta = [item.origin === 'active' ? '主动沉淀' : '后台沉淀', memoryScopeLabel(item, projects), item.source, formatSettingsDate(item.updatedAt), `${Number(item.chars || 0).toLocaleString()} 字符`].filter(Boolean);

              return (
                <div className="chat-user-settings__memory-item" key={item.id}>
                  <div className="chat-user-settings__memory-item-head">
                    <FileText size={14} />
                    <span title={item.workspaceRoot || item.title}>{item.title}</span>
                    <IconButton label="删除记忆" variant="danger" disabled={memoryResetting || memoryPreviewLoading || memoryDeletingId === item.id} onClick={() => void deleteMemoryItem(item)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                  <div className="chat-user-settings__memory-item-meta">
                    {meta.map((value, index) => (
                      <span key={`${value}-${index}`}>{value}</span>
                    ))}
                  </div>
                  {item.tags?.length ? (
                    <div className="chat-user-settings__memory-tags">
                      {item.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                  <pre className="chat-user-settings__memory-snippet">{item.preview}</pre>
                </div>
              );
            })
          ) : (
            <EmptyState title={memoryPreviewLoading ? '正在加载记忆' : '暂无沉淀下来的记忆'} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__personalization-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">风格</div>
        <div className="chat-user-settings__group chat-user-settings__personalization-card">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Pencil size={14} />
              <span>Setsuna 风格</span>
            </span>
            <SettingsChoiceGroup ariaLabel="Setsuna 风格" options={setsunaStyleOptions} value={config.setsunaStyle} onChange={(setsunaStyle) => void onSavePreferences({ setsunaStyle })} />
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group chat-user-settings__personalization-card chat-user-settings__personalization-card--prompt">
          <div className="chat-user-settings__prompt-stack">
            <div className="chat-user-settings__prompt-heading">
              <div className="chat-user-settings__prompt-title">
                <span>全局 prompt</span>
              </div>
              <p>会作为桌面端对话的长期偏好放入上下文，适合写固定口吻、工作习惯和长期约束。</p>
            </div>
            <div className="chat-user-settings__prompt-control">
              <div className="chat-user-settings__prompt-input-shell">
                <TextArea
                  className="chat-user-settings__prompt-input"
                  value={globalPromptDraft}
                  maxLength={PERSONALIZATION_PROMPT_MAX_LENGTH}
                  placeholder="写给 Setsuna 的长期偏好，会放入桌面端对话上下文。"
                  onBlur={() => {
                    if (globalPromptDraft === config.globalPrompt) return;
                    void onSavePreferences({ globalPrompt: globalPromptDraft });
                  }}
                  onChange={(event) => setGlobalPromptDraft(event.target.value)}
                />
                <span className="chat-user-settings__prompt-count">
                  {globalPromptLength} / {PERSONALIZATION_PROMPT_MAX_LENGTH}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block chat-user-settings__memory-settings-block">
        <div className="chat-user-settings__memory-heading">
          <div className="chat-user-settings__group-title">记忆</div>
          <p>记忆用于保存你希望长期生效的偏好、项目规则、固定流程和事实信息。开启后，后续对话会按当前项目或全局范围自动召回相关记忆，帮助模型延续你的工作习惯；自定义位置会在所选目录内使用 .setsuna-memory 专属子目录，不会改动同级文件。</p>
        </div>
        {memoryError ? <div className="chat-user-settings__memory-error">{memoryError}</div> : null}
        <div className="chat-user-settings__group chat-user-settings__personalization-card">
          <MemorySettingToggle checked={config.memory.useMemories} description="允许对话开始时读取本地记忆，并把相关偏好、项目规则和历史经验放进模型上下文。" label="使用记忆" onChange={(checked) => void onSavePreferences({ memory: { useMemories: checked } })} />
          <MemorySettingToggle checked={config.memory.generateMemories} description="允许运行时在对话结束后提炼新的长期记忆；关闭后只会读取已有记忆，不再自动新增。" label="生成记忆" onChange={(checked) => void onSavePreferences({ memory: { generateMemories: checked } })} />
          <MemoryExtractModelField config={config} onSavePreferences={onSavePreferences} />
          <MemorySettingToggle checked={config.memory.disableOnExternalContext} description="当本轮内容包含网页、MCP、外部工具等临时资料时，禁止把这类上下文沉淀成长期记忆。" label="外部上下文禁写" onChange={(checked) => void onSavePreferences({ memory: { disableOnExternalContext: checked } })} />
          <MemorySettingToggle checked={config.memory.dedicatedTools} description="把读取、搜索和写入记忆的专用工具暴露给模型；适合需要模型主动管理记忆时开启。" label="专用记忆工具" onChange={(checked) => void onSavePreferences({ memory: { dedicatedTools: checked } })} />
          <div className="chat-user-settings__row chat-user-settings__local-field">
            <span className="chat-user-settings__row-label">
              <FolderOpen size={14} />
              <span>存储容器</span>
            </span>
            <div className="chat-user-settings__local-storage-control">
              <TextField className="settings-local-control" value={storagePath} readOnly />
              <Button icon={<FolderOpen size={14} />} disabled={selectingStorage} onClick={() => void selectMemoryStoragePath()}>
                {selectingStorage ? '选择中' : '选择'}
              </Button>
            </div>
          </div>
          <div className="chat-user-settings__row chat-user-settings__local-action-row">
            <span className="chat-user-settings__row-label">
              <Eye size={14} />
              <span>记忆预览</span>
            </span>
            <Button className="chat-user-settings__preview-open" icon={<ChevronRight size={14} />} onClick={() => void openMemoryPreview()}>
              查看
            </Button>
          </div>
          <div className="chat-user-settings__row chat-user-settings__local-action-row chat-user-settings__memory-reset-row">
            <span className="chat-user-settings__row-label">
              <RefreshCw size={14} />
              <span>重置记忆</span>
            </span>
            <Popconfirm title="重置全部记忆？" description="只会清空 Setsuna 管理的记忆子目录，不影响所选目录内其他文件；该操作无法撤销。" placement="topRight" okText="重置" cancelText="取消" okButtonProps={{ danger: true, loading: memoryResetting }} onConfirm={() => void resetMemoryItems()}>
              <Button variant="danger" icon={<RefreshCw size={14} />} disabled={memoryPreviewLoading || Boolean(memoryDeletingId) || memoryResetting}>
                {memoryResetting ? '重置中' : '重置'}
              </Button>
            </Popconfirm>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryExtractModelField({ config, onSavePreferences }: { config: RuntimeConfigState; onSavePreferences: (input: RuntimePreferenceInput) => Promise<void> }) {
  if (!config.memory.generateMemories) return null;

  const options = memoryExtractModelOptions(config);
  const value = config.memory.extractModel?.trim() ?? '';
  const currentOptionExists = !value || options.some((option) => option.value === value);

  return (
    <label className="chat-user-settings__row chat-user-settings__memory-model-row">
      <span className="chat-user-settings__row-label chat-user-settings__memory-model-label">
        <span className="chat-user-settings__memory-toggle-copy">
          <span>提取模型</span>
          <small>用于对话后的记忆提炼，不影响当前回答；留空跟随当前模型。</small>
        </span>
      </span>
      <SelectField
        className="settings-local-control chat-user-settings__memory-model-select"
        value={value}
        onValueChange={(nextValue) => {
          const extractModel = nextValue.trim() || undefined;
          void onSavePreferences({ memory: { extractModel } });
        }}
      >
        <option value="">跟随当前对话模型</option>
        {!currentOptionExists ? (
          <option value={value} disabled>
            {`${value}（当前厂商未配置）`}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectField>
    </label>
  );
}

function memoryScopeLabel(item: RuntimeMemoryPreviewItem, projects: WorkspaceProject[]): string {
  if (item.scope === 'global') return '全局';
  const projectName = projects.find((project) => project.id === item.projectId)?.name;
  return projectName ? `项目：${projectName}` : item.projectId ? `项目：${item.projectId}` : '项目范围';
}
