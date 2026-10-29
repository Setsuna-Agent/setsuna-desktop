import { TextField as UiTextField, Button as UiButton, Switch, usePageSessionState, usePageScrollRestoration } from '@setsuna-desktop/renderer-ui';

import type {
  RuntimeSkillDetail,
  RuntimeSkillInput,
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
import type { SkillsRendererHost, SkillsRendererService } from '../contracts/index.js';
import type { SkillsTranslate } from './messages.js';
import { SkillDetail } from './SkillDetail.js';
import { useSkillPageActions } from './useSkillPageActions.js';
import { groupSkillsBySource, skillDirectoryPresets } from './skillCatalog.js';

type SkillEditorDraft = Readonly<{
  content: string;
  description: string;
  enabled: boolean;
  id: string;
  name: string;
}>;

export function SkillsCapabilitiesPage({
  capabilities,
  capabilitiesRefresh,
  host,
  service,
  translate,
  ui,
}: SettingsPageSlotProps & Readonly<{
  capabilitiesRefresh: CapabilitiesRefreshCoordinator;
  host: SkillsRendererHost;
  service: SkillsRendererService;
}>) {
  const snapshot = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [query, setQuery] = usePageSessionState('capabilities:skills:query', '');
  const actions = useSkillPageActions(service, capabilitiesRefresh, translate, host, capabilities);
  const { mode, summary, detail, error, loading, saving, operationError, pending } = actions;
  const catalogViewport = useRef<HTMLDivElement>(null);
  usePageScrollRestoration(`capabilities:skills:${mode}:${query}`, catalogViewport);

  useEffect(() => {
    if (snapshot.skills.length) return;
    void service.refresh().catch(() => undefined);
  }, [service, snapshot.skills.length]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSkills = useMemo(() => snapshot.skills.filter((skill) => (
    !normalizedQuery
    || `${skill.name} ${skill.description ?? ''} ${skill.id}`.toLocaleLowerCase().includes(normalizedQuery)
  )), [normalizedQuery, snapshot.skills]);
  const skillGroups = useMemo(
    () => groupSkillsBySource(visibleSkills, snapshot.extraRoots, translate),
    [visibleSkills, snapshot.extraRoots, translate],
  );

  if (mode === 'create' || mode === 'edit') {
    return (
      <>
        <SkillEditor
          capabilities={capabilities}
          mode={mode}
          saving={saving}
          skill={mode === 'edit' ? detail : null}
          translate={translate}
          ui={ui}
          onBack={actions.closeEditor}
          onSave={actions.saveSkill}
        />
        {operationError ? <ui.Toast message={operationError} tone="error" /> : null}
      </>
    );
  }

  if (mode === 'detail' && summary) {
    return (
      <>
        <SkillDetail
          capabilities={capabilities}
          detail={detail}
          error={error}
          loading={loading}
          pendingDependencies={new Set(pending.get(summary.id) === 'install' ? ['install'] : [])}
          pending={pending.has(summary.id)}
          revealLabel={translate(host.platform === 'darwin' ? 'feature.skills.revealInFinder' : 'feature.skills.revealInExplorer')}
          summary={summary}
          translate={translate}
          ui={ui}
          onBack={actions.closeDetail}
          onDelete={summary.kind === 'builtin' ? undefined : () => actions.deleteSkill(summary)}
          onEdit={summary.kind === 'builtin' ? undefined : actions.openEditor}
          onInstallDependencies={() => actions.installDependencies(summary)}
          onRevealFile={detail?.path ? () => actions.revealFile(detail) : undefined}
          onToggle={(enabled) => void actions.toggleSkill(summary, enabled)}
          onUseInChat={capabilities ? () => capabilities.openChat(summary.id) : undefined}
        />
        {operationError ? <ui.Toast message={operationError} tone="error" /> : null}
      </>
    );
  }

  return (
    <main className="capabilities-page desktop-capabilities-panel" data-feature-id="skills">
      <section className={`desktop-capabilities-panel__inner desktop-capabilities-panel__inner--catalog desktop-capabilities-panel__inner--skills${capabilities?.catalogNavigationInPage ? ' desktop-capabilities-panel__inner--page-tabs' : ''}`}>
        {capabilities?.catalogNavigation}
        <header className="desktop-capabilities-header">
          <div className="desktop-capabilities-title"><h2>{translate('feature.skills.title')}</h2></div>
          <div className="desktop-capabilities-actions">
            <ui.IconButton label={translate('feature.skills.refresh')} disabled={actions.refreshing} onClick={() => void actions.refresh()}>
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
                  onSelect: actions.openCreate,
                  title: translate('feature.skills.createForm'),
                },
              ],
              onOpenChange: setCreateMenuOpen,
              open: createMenuOpen,
            }) : (
              <ui.Button variant="primary" icon={<FilePlus2 size={14} />} onClick={actions.openCreate}>
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
        <div className="desktop-capabilities-grid" ref={catalogViewport}>
          <div className="desktop-capabilities-grid__content">
            <div className="desktop-capability-catalog">
              {skillGroups.map(({ id, title, skills: groupSkills }) => (
                <section className="desktop-capability-catalog__section" key={id}>
                  <header><h3>{title}</h3><span>{groupSkills.length}</span></header>
                  <div className="desktop-capability-list">
                    {groupSkills.map((skill) => (
                      <SkillListItem
                        key={skill.id}
                        skill={skill}
                        translate={translate}
                        ui={ui}
                        pending={pending.has(skill.id)}
                        onOpen={() => void actions.openSkill(skill)}
                        onToggle={(enabled) => void actions.toggleSkill(skill, enabled)}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {!visibleSkills.length && !actions.refreshing && !operationError ? <div className="desktop-capabilities-empty">{translate('feature.skills.empty')}</div> : null}
            </div>
          </div>
        </div>
      </section>
      {operationError ? <ui.Toast message={operationError} tone="error" /> : null}
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
  pending,
  onOpen,
  onToggle,
  skill,
  translate,
  ui,
}: Readonly<{
  pending: boolean;
  onOpen(): void;
  onToggle(enabled: boolean): void;
  skill: RuntimeSkillSummary;
  translate: SkillsTranslate;
  ui: SettingsViewUi;
}>) {
  return (
    <article className="desktop-capability-list-item desktop-capability-list-item--skill">
      <UiButton variant="ghost" className="desktop-capability-list-item__identity" type="button" onClick={onOpen}>
        <ui.SkillIcon variant="list" />
        <span className="desktop-capability-list-item__copy"><strong>{skill.name}</strong><span title={skill.description || skill.id}>{skill.description || skill.id}</span></span>
      </UiButton>
      <div className="desktop-capability-list-item__aside">
        <div className="desktop-capability-list-item__settings">
          <span className="sd-toggle-label"><Switch label={translate('feature.skills.enableHint')} checked={skill.enabled} disabled={pending} onCheckedChange={(checked) => onToggle(checked)} /></span>
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
        <section className="sd-detail desktop-capabilities-skill-editor">
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
            <label><span>{translate('feature.skills.editor.name')}</span><ui.TextField disabled={saving} placeholder={translate('feature.skills.editor.namePlaceholder')} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
            <label><span>{translate('feature.skills.editor.id')}</span><ui.TextField disabled={saving || !creating} placeholder={translate('feature.skills.editor.idPlaceholder')} value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.currentTarget.value })} /></label>
            <label className="desktop-capabilities-skill-form__full"><span>{translate('feature.skills.editor.description')}</span><ui.TextArea disabled={saving} placeholder={translate('feature.skills.editor.descriptionPlaceholder')} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })} /></label>
            <label className="desktop-capabilities-skill-form__full"><span>{translate('feature.skills.editor.content')}</span><ui.TextArea disabled={saving} className="desktop-capabilities-skill-form__content" placeholder={translate('feature.skills.editor.contentPlaceholder')} spellCheck={false} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.currentTarget.value })} /></label>
            <div className="desktop-capabilities-skill-form__checks">
              <span className="sd-toggle-label"><Switch label={translate('feature.skills.enableHint')} checked={draft.enabled} disabled={saving} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })} /><span>{translate('feature.skills.enabled')}</span></span>
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
