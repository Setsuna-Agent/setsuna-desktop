import { useConfirm } from '@setsuna-desktop/renderer-ui';
import { TextField as UiTextField, Button as UiButton, Switch } from '@setsuna-desktop/renderer-ui';

import type {
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillPatch,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import type { CapabilitiesRefreshCoordinator } from '@setsuna-desktop/renderer-contracts/capabilities';
import type {
  CapabilitiesPageNavigation,
  SettingsPageSlotProps,
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import {
  FilePlus2,
  MessageSquare,
  RefreshCw,
  Save,
  Search,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { SkillsRendererService } from '../contracts/index.js';
import type { SkillsTranslate } from './messages.js';
import { SkillDetail } from './SkillDetail.js';

type SkillPageMode = 'catalog' | 'create' | 'detail' | 'edit';

type SkillEditorDraft = Readonly<{
  content: string;
  description: string;
  enabled: boolean;
  id: string;
  name: string;
}>;

const skillGroups = [
  ['user', 'feature.skills.category.user'],
  ['plugin', 'feature.skills.category.plugin'],
  ['builtin', 'feature.skills.category.builtin'],
] as const;

const skillDirectoryPresets = [
  { id: 'global', labelKey: 'feature.skills.directory.global', homeRelativePath: ['.agents', 'skills'] },
  { id: 'codex', labelKey: 'feature.skills.directory.codex', homeRelativePath: ['.codex', 'skills'] },
  { id: 'claude', labelKey: 'feature.skills.directory.claude', homeRelativePath: ['.claude', 'skills'] },
  { id: 'grok', labelKey: 'feature.skills.directory.grok', homeRelativePath: ['.grok', 'skills'] },
  { id: 'pi', labelKey: 'feature.skills.directory.pi', homeRelativePath: ['.pi', 'agent', 'skills'] },
] as const;

export function SkillsCapabilitiesPage({
  capabilities,
  capabilitiesRefresh,
  service,
  translate,
  ui,
}: SettingsPageSlotProps & Readonly<{
  capabilitiesRefresh: CapabilitiesRefreshCoordinator;
  service: SkillsRendererService;
}>) {
  const confirm = useConfirm();
  const snapshot = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
  const [mode, setMode] = useState<SkillPageMode>('catalog');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<RuntimeSkillSummary | null>(null);
  const [detail, setDetail] = useState<RuntimeSkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDependencies, setPendingDependencies] = useState<ReadonlySet<string>>(new Set());
  const requestVersion = useRef(0);

  useEffect(() => {
    if (snapshot.skills.length) return;
    void service.refresh().catch(() => undefined);
  }, [service, snapshot.skills.length]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSkills = useMemo(() => snapshot.skills.filter((skill) => (
    !normalizedQuery
    || `${skill.name} ${skill.description ?? ''} ${skill.id}`.toLocaleLowerCase().includes(normalizedQuery)
  )), [normalizedQuery, snapshot.skills]);

  const closeDetail = () => {
    requestVersion.current += 1;
    setMode('catalog');
    setSummary(null);
    setDetail(null);
    setError(null);
  };
  const openSkill = async (skill: RuntimeSkillSummary) => {
    const request = ++requestVersion.current;
    setMode('detail');
    setSummary(skill);
    setDetail(null);
    setError(null);
    setLoading(true);
    try {
      const loaded = await service.getSkill(skill.id);
      if (request !== requestVersion.current) return;
      setSummary(loaded);
      setDetail(loaded);
    } catch (unknownError) {
      if (request === requestVersion.current) setError(errorMessage(unknownError));
    } finally {
      if (request === requestVersion.current) setLoading(false);
    }
  };
  const refreshPluginCatalog = async (skill: RuntimeSkillSummary) => {
    if (skill.kind === 'plugin') await capabilitiesRefresh.refresh(['plugin-management']);
  };
  const updateSkill = async (skill: RuntimeSkillSummary, patch: RuntimeSkillPatch) => {
    const updated = await service.updateSkill(skill.id, patch);
    await refreshPluginCatalog(skill);
    if (summary?.id === updated.id) {
      setSummary(updated);
      setDetail(updated);
    }
    return updated;
  };
  const saveSkill = async (input: RuntimeSkillInput) => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = mode === 'create'
        ? await service.createSkill(input)
        : summary
          ? await updateSkill(summary, skillPatch(input))
          : null;
      if (!saved) return;
      setSummary(saved);
      setDetail(saved);
      setMode('detail');
    } finally {
      setSaving(false);
    }
  };
  const deleteSkill = async (skill: RuntimeSkillSummary) => {
    if (!await confirm({
      title: translate('feature.skills.confirmDelete', { name: skill.name }),
      confirmLabel: translate('feature.skills.delete'),
      danger: true,
    })) return;
    await service.deleteSkill(skill.id);
    await refreshPluginCatalog(skill);
    closeDetail();
  };
  const updateDependency = async (
    key: string,
    operation: () => Promise<RuntimeSkillDetail>,
  ) => {
    setPendingDependencies((current) => new Set(current).add(key));
    try {
      const updated = await operation();
      setSummary(updated);
      setDetail(updated);
      await capabilitiesRefresh.refresh(['mcp']);
    } finally {
      setPendingDependencies((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  if (mode === 'create' || mode === 'edit') {
    return (
      <SkillEditor
        capabilities={capabilities}
        mode={mode}
        saving={saving}
        skill={mode === 'edit' ? detail : null}
        translate={translate}
        ui={ui}
        onBack={() => detail ? setMode('detail') : closeDetail()}
        onSave={saveSkill}
      />
    );
  }

  if (mode === 'detail' && summary) {
    return (
      <SkillDetail
        capabilities={capabilities}
        detail={detail}
        error={error}
        loading={loading}
        pendingDependencies={pendingDependencies}
        summary={summary}
        translate={translate}
        ui={ui}
        onBack={closeDetail}
        onDelete={summary.kind === 'builtin' ? undefined : () => deleteSkill(summary)}
        onEdit={summary.kind === 'builtin' ? undefined : () => setMode('edit')}
        onInstallDependencies={() => updateDependency(
          'install',
          () => service.installMcpDependencies(summary.id).then((result) => result.skill),
        )}
        onToggle={(enabled) => void updateSkill(summary, { enabled })}
        onUseInChat={capabilities ? () => capabilities.openChat(summary.id) : undefined}
      />
    );
  }

  return (
    <main className="capabilities-page desktop-capabilities-panel" data-feature-id="skills">
      <section className={`desktop-capabilities-panel__inner desktop-capabilities-panel__inner--catalog desktop-capabilities-panel__inner--skills${capabilities?.catalogNavigationInPage ? ' desktop-capabilities-panel__inner--page-tabs' : ''}`}>
        {capabilities?.catalogNavigation}
        <header className="desktop-capabilities-header">
          <div className="desktop-capabilities-title"><h2>{translate('feature.skills.title')}</h2></div>
          <div className="desktop-capabilities-actions">
            <ui.IconButton label={translate('feature.skills.refresh')} onClick={() => void service.refresh()}>
              <RefreshCw size={15} />
            </ui.IconButton>
            {capabilities ? capabilities.renderCreateMenu({
              buttonLabel: translate('feature.skills.create'),
              items: [
                {
                  description: translate('feature.skills.createChatDescription'),
                  icon: <MessageSquare size={14} />,
                  id: 'chat-skill',
                  onSelect: () => capabilities.openChat('create-skill-in-chat'),
                  title: translate('feature.skills.createChat'),
                },
                {
                  description: translate('feature.skills.createFormDescription'),
                  icon: <FilePlus2 size={14} />,
                  id: 'form-skill',
                  onSelect: () => setMode('create'),
                  title: translate('feature.skills.createForm'),
                },
              ],
              onOpenChange: setCreateMenuOpen,
              open: createMenuOpen,
            }) : (
              <ui.Button variant="primary" icon={<FilePlus2 size={14} />} onClick={() => setMode('create')}>
                {translate('feature.skills.add')}
              </ui.Button>
            )}
          </div>
        </header>
        <div className="desktop-capabilities-search-row">
          <label className="desktop-capabilities-search">
            <Search size={14} />
            <UiTextField
              aria-label={translate('feature.skills.search')}
              placeholder={translate('feature.skills.search')}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="desktop-capabilities-grid">
          <div className="desktop-capabilities-grid__content">
            <div className="desktop-skill-catalog">
              {skillGroups.map(([kind, titleKey]) => {
                const groupSkills = visibleSkills.filter((skill) => skill.kind === kind);
                if (!groupSkills.length) return null;
                return (
                  <section className="desktop-skill-catalog__section" key={kind}>
                    <header><h3>{translate(titleKey)}</h3><span>{groupSkills.length}</span></header>
                    <div className="desktop-capability-list">
                      {groupSkills.map((skill) => (
                        <SkillListItem
                          key={skill.id}
                          skill={skill}
                          translate={translate}
                          ui={ui}
                          onOpen={() => void openSkill(skill)}
                          onToggle={(enabled) => void updateSkill(skill, { enabled })}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
              {!visibleSkills.length ? <div className="desktop-capabilities-empty">{translate('feature.skills.empty')}</div> : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export function SkillsExtraRootsSettings({
  service,
  translate,
  ui,
}: Readonly<{
  service: SkillsRendererService;
  translate: SkillsTranslate;
  ui: SettingsViewUi;
}>) {
  const snapshot = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
  const directoryPresets = useMemo(() => skillDirectoryPresets.map((preset) => ({
    homeRelativePath: preset.homeRelativePath,
    id: preset.id,
    label: translate(preset.labelKey),
  })), [translate]);
  const inspectDirectories = useCallback(async (paths: readonly string[]) => {
    const result = await service.inspectDirectories([...paths]);
    return result.directories.map((directory) => ({
      count: directory.skillCount,
      path: directory.path,
    }));
  }, [service]);

  return (
    <ui.Group>
      <ui.DirectoryList
        description={translate('feature.skills.extraRootsDescription')}
        formatPresetCount={(count) => translate('feature.skills.directory.count', { count })}
        inspectDirectories={inspectDirectories}
        label={translate('feature.skills.extraRoots')}
        presetAddLabel={translate('feature.skills.inherit')}
        presetRemoveLabel={translate('feature.skills.stopInheriting')}
        presets={directoryPresets}
        value={snapshot.extraRoots}
        onSave={(roots) => service.setExtraRoots(roots)}
      />
    </ui.Group>
  );
}

function SkillListItem({
  onOpen,
  onToggle,
  skill,
  translate,
  ui,
}: Readonly<{
  onOpen(): void;
  onToggle(enabled: boolean): void;
  skill: RuntimeSkillSummary;
  translate: SkillsTranslate;
  ui: SettingsViewUi;
}>) {
  return (
    <article className="desktop-capability-list-item desktop-capability-list-item--skill">
      <UiButton variant="ghost" className="desktop-capability-list-item__identity" type="button" onClick={onOpen}>
        <ui.SkillIcon skill={skill} variant="list" />
        <span className="desktop-capability-list-item__copy"><strong>{skill.name}</strong><span title={skill.description || skill.id}>{skill.description || skill.id}</span></span>
      </UiButton>
      <div className="desktop-capability-list-item__aside">
        <div className="desktop-capability-list-item__settings">
          <span className="sd-toggle-label"><Switch label={translate('feature.skills.enableHint')} checked={skill.enabled} onCheckedChange={(checked) => onToggle(checked)} /></span>
        </div>
      </div>
    </article>
  );
}

function SkillEditor({
  capabilities,
  mode,
  onBack,
  onSave,
  saving,
  skill,
  translate,
  ui,
}: Readonly<{
  capabilities?: CapabilitiesPageNavigation;
  mode: 'create' | 'edit';
  onBack(): void;
  onSave(input: RuntimeSkillInput): Promise<void>;
  saving: boolean;
  skill: RuntimeSkillDetail | null;
  translate: SkillsTranslate;
  ui: SettingsViewUi;
}>) {
  const creating = mode === 'create';
  const [draft, setDraft] = useState<SkillEditorDraft>(() => skillDraft(skill));
  useEffect(() => setDraft(skillDraft(skill)), [skill]);
  const title = creating ? translate('feature.skills.editor.create') : skill?.name || translate('feature.skills.editor.edit');
  return (
    <main className="capabilities-page desktop-capabilities-panel" data-feature-id="skills">
      <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
        {capabilities?.renderBreadcrumb({
          currentLabel: title,
          parentLabel: translate('feature.skills.title'),
          onBack,
        })}
        <section className="desktop-capabilities-detail desktop-capabilities-skill-editor">
          <ui.PageHeader
            actions={(
              <ui.Button
                disabled={saving || !draft.name.trim() || !draft.content.trim()}
                icon={<Save size={14} />}
                variant="primary"
                onClick={() => void onSave(skillInput(draft, creating))}
              >
                {translate(saving ? 'feature.skills.saving' : 'feature.skills.save')}
              </ui.Button>
            )}
            subtitle={translate(creating ? 'feature.skills.editor.createSubtitle' : 'feature.skills.editor.editSubtitle')}
            title={title}
          />
          <div className="desktop-capabilities-skill-form">
            <label><span>{translate('feature.skills.editor.name')}</span><ui.TextField placeholder={translate('feature.skills.editor.namePlaceholder')} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
            <label><span>{translate('feature.skills.editor.id')}</span><ui.TextField disabled={!creating} placeholder={translate('feature.skills.editor.idPlaceholder')} value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.currentTarget.value })} /></label>
            <label className="desktop-capabilities-skill-form__full"><span>{translate('feature.skills.editor.description')}</span><ui.TextArea placeholder={translate('feature.skills.editor.descriptionPlaceholder')} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })} /></label>
            <label className="desktop-capabilities-skill-form__full"><span>{translate('feature.skills.editor.content')}</span><ui.TextArea className="desktop-capabilities-skill-form__content" placeholder={translate('feature.skills.editor.contentPlaceholder')} spellCheck={false} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.currentTarget.value })} /></label>
            <div className="desktop-capabilities-skill-form__checks">
              <span className="sd-toggle-label"><Switch label={translate('feature.skills.enableHint')} checked={draft.enabled} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })} /><span>{translate('feature.skills.enabled')}</span></span>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function skillDraft(skill: RuntimeSkillDetail | null): SkillEditorDraft {
  return {
    content: skill?.content ?? '',
    description: skill?.description ?? '',
    enabled: skill?.enabled ?? true,
    id: skill?.id ?? '',
    name: skill?.name ?? '',
  };
}

function skillInput(draft: SkillEditorDraft, includeId: boolean): RuntimeSkillInput {
  return {
    ...(includeId && draft.id.trim() ? { id: draft.id.trim() } : {}),
    content: draft.content.trim(),
    description: draft.description.trim() || undefined,
    enabled: draft.enabled,
    name: draft.name.trim(),
  };
}

function skillPatch(input: RuntimeSkillInput): RuntimeSkillPatch {
  const { id: _id, ...patch } = input;
  return patch;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
