import type { ComposerSlot } from './editor/types.js';
import { browserTabMentionText, parseBrowserTabMentions, type BrowserTabReference } from '@setsuna-desktop/feature-browser/contracts';
import { normalizeRuntimeSkillReferences, parsePluginMentions, pluginAppMentionText, pluginMentionText, type RuntimeMessage, type RuntimePluginAppReference, type RuntimePluginSummary } from '@setsuna-desktop/contracts';
import type {
  RuntimeSkillReference,
  RuntimeSkillSummary,
  WorkspaceEntrySearchItem,
} from '@setsuna-desktop/contracts';
import { WorkspaceMentionLabel } from '../mentions/WorkspaceMentionLabel.js';
import { BrowserTabReferenceLabel } from '../mentions/BrowserTabReference.js';
import { SkillReferenceLabel } from '../skills/SkillReference.js';
import { PluginReferenceLabel } from '../references/PluginReference.js';
import { PluginAppReferenceLabel } from '../references/PluginAppReferenceLabel.js';
import { entryLabel, skillDisplayText } from './chatCommandUtils.js';

const workspaceMentionSlotKeyPrefix = 'workspace:';
const selectedSkillSlotKeyPrefix = 'skill:';

export type ChatComposerSlotReference =
  | { type: 'skill'; skillId: string }
  | { type: 'plugin'; pluginId: string; contributionId?: string }
  | { type: 'browser-tab'; tab: BrowserTabReference }
  | { type: 'workspace'; entry: WorkspaceEntrySearchItem };

export type ChatComposerReferenceSlot = Extract<ComposerSlot, { type: 'tag' }> & {
  composerReference: ChatComposerSlotReference;
};

export type WorkspaceMentionInsertion = {
  replaceCharacters?: string;
  slots: ComposerSlot[];
};

export function createTextSlot(value: string): ComposerSlot {
  return { type: 'text', value };
}

export function createSelectedSkillSlot(skill: RuntimeSkillSummary): ChatComposerReferenceSlot {
  const tokenText = skillDisplayText(skill);
  return {
    type: 'tag',
    key: createReferenceSlotKey(selectedSkillSlotKeyPrefix),
    composerReference: { type: 'skill', skillId: skill.id },
    props: {
      label: <SkillReferenceLabel skill={skill} />,
      value: tokenText,
    },
  };
}

export function createSelectedPluginSlot(plugin: RuntimePluginSummary): ChatComposerReferenceSlot {
  return {
    type: 'tag',
    key: createReferenceSlotKey('plugin:'),
    composerReference: { type: 'plugin', pluginId: plugin.id },
    props: { label: <PluginReferenceLabel plugin={plugin} label={plugin.name} />, value: pluginMentionText(plugin) },
  };
}

export function createPluginAppMentionSlot(app: RuntimePluginAppReference): ChatComposerReferenceSlot {
  return {
    type: 'tag', key: createReferenceSlotKey('plugin:'),
    composerReference: { type: 'plugin', pluginId: app.pluginId, contributionId: app.contributionId },
    props: { label: <PluginAppReferenceLabel app={app} />, value: pluginAppMentionText(app) },
  };
}

export function createBrowserTabMentionSlot(tab: BrowserTabReference): ChatComposerReferenceSlot {
  const value = browserTabMentionText(tab);
  return {
    type: 'tag',
    key: createReferenceSlotKey('browser-tab:'),
    composerReference: { type: 'browser-tab', tab: { id: tab.id, title: tab.title, url: tab.url } },
    props: { label: <BrowserTabReferenceLabel tab={tab} serializedText={value} />, value },
  };
}

export function createReferenceDraftSlots(
  value: string,
  plugins: readonly RuntimePluginSummary[],
  skills: readonly RuntimeSkillSummary[] = [],
  skillReferences: RuntimeSkillReference[] = [],
): ComposerSlot[] {
  const slots: ComposerSlot[] = [];
  let offset = 0;
  const references = normalizeRuntimeSkillReferences({
    content: value, references: skillReferences, skillIds: skills.filter((skill) => skill.enabled).map((skill) => skill.id),
  });
  for (const reference of references) {
    const skill = skills.find((item) => item.id === reference.skillId)!;
    slots.push(...createBrowserAndPluginDraftSlots(value.slice(offset, reference.start), plugins));
    const slot = createSelectedSkillSlot(skill);
    slot.props.value = value.slice(reference.start, reference.end);
    slots.push(slot);
    offset = reference.end;
  }
  slots.push(...createBrowserAndPluginDraftSlots(value.slice(offset), plugins));
  return slots;
}

function createBrowserAndPluginDraftSlots(value: string, plugins: readonly RuntimePluginSummary[]): ComposerSlot[] {
  const slots: ComposerSlot[] = [];
  let offset = 0;
  for (const mention of parseBrowserTabMentions(value)) {
    slots.push(...createPluginDraftSlots(value.slice(offset, mention.start), plugins));
    const slot = createBrowserTabMentionSlot(mention.tab);
    slot.props.value = value.slice(mention.start, mention.end);
    slots.push(slot);
    offset = mention.end;
  }
  slots.push(...createPluginDraftSlots(value.slice(offset), plugins));
  return slots;
}

/** Rehydrate plugin tags when a saved draft or queued message returns to the composer. */
export function createPluginDraftSlots(value: string, plugins: readonly RuntimePluginSummary[]): ComposerSlot[] {
  const slots: ComposerSlot[] = [];
  let offset = 0;
  for (const mention of parsePluginMentions(value)) {
    const plugin = plugins.find((item) => item.id === mention.pluginId);
    if (!plugin) continue;
    if (mention.start > offset) slots.push(createTextSlot(value.slice(offset, mention.start)));
    const slot = mention.contributionId
      ? createPluginAppMentionSlot({ pluginId: plugin.id, contributionId: mention.contributionId, name: mention.label })
      : createSelectedPluginSlot(plugin);
    // Keep the exact serialized text so rehydration does not change the draft or other slot offsets.
    slot.props.value = value.slice(mention.start, mention.end);
    slots.push(slot);
    offset = mention.end;
  }
  if (offset < value.length) slots.push(createTextSlot(value.slice(offset)));
  return slots;
}

export function createMessageDraftSlots(
  message: RuntimeMessage,
  skills: RuntimeSkillSummary[],
  plugins: readonly RuntimePluginSummary[],
): ComposerSlot[] {
  const references = normalizeRuntimeSkillReferences({
    content: message.content,
    skillIds: message.skillIds ?? [],
    references: message.skillReferences,
  });
  return createReferenceDraftSlots(message.content, plugins, skills, references);
}

export function filterSelectedSkillsBySlots(
  skills: RuntimeSkillSummary[],
  slotConfig: ComposerSlot[] | undefined,
): RuntimeSkillSummary[] {
  const selectedSkillIds = new Set(
    (slotConfig ?? [])
      .map(selectedSkillIdForSlot)
      .filter((skillId): skillId is string => Boolean(skillId)),
  );
  const filteredSkills = skills.filter((skill) => selectedSkillIds.has(skill.id));
  return filteredSkills.length === skills.length ? skills : filteredSkills;
}

export function hasSelectedSkillSlot(
  skillId: string,
  slotConfig: ComposerSlot[] | undefined,
): boolean {
  return (slotConfig ?? []).some((slot) => selectedSkillIdForSlot(slot) === skillId);
}

/** Sending trims outer whitespace; retained drafts use offsets into the untrimmed editor value. */
export function createSelectedSkillReferences(
  slotConfig: ComposerSlot[] | undefined,
  { trim = true }: { trim?: boolean } = {},
): RuntimeSkillReference[] {
  const slots = slotConfig ?? [];
  const serializedContent = slots.map(serializedSlotValue).join('');
  const leadingTrim = trim ? serializedContent.length - serializedContent.trimStart().length : 0;
  const trimmedEnd = trim ? serializedContent.trimEnd().length : serializedContent.length;
  const references: RuntimeSkillReference[] = [];
  let offset = 0;

  for (const slot of slots) {
    const value = serializedSlotValue(slot);
    const skillId = selectedSkillIdForSlot(slot);
    const end = offset + value.length;
    if (skillId && value && offset >= leadingTrim && end <= trimmedEnd) {
      references.push({ skillId, start: offset - leadingTrim, end: end - leadingTrim });
    }
    offset = end;
  }
  return references;
}

export function createWorkspaceMentionSlots(entry: WorkspaceEntrySearchItem, leadingText = ''): ComposerSlot[] {
  return [
    ...(leadingText ? [createTextSlot(leadingText)] : []),
    createWorkspaceMentionReferenceSlot(entry),
    createTextSlot(' '),
  ];
}

export function createWorkspaceMentionReferenceSlot(
  entry: WorkspaceEntrySearchItem,
): ChatComposerReferenceSlot {
  const resultText = `@${entryLabel(entry)}`;
  return {
    type: 'tag',
    key: createReferenceSlotKey(workspaceMentionSlotKeyPrefix),
    composerReference: { type: 'workspace', entry },
    props: {
      label: (
        <WorkspaceMentionLabel
          name={entry.name}
          path={entry.absolutePath ?? entry.path}
          serializedText={resultText}
          type={entry.kind}
        />
      ),
      value: resultText,
    },
  };
}

export function getChatComposerSlotReference(
  slot: ComposerSlot,
): ChatComposerSlotReference | null {
  return (slot as Partial<ChatComposerReferenceSlot>).composerReference ?? null;
}

export function createWorkspaceMentionInsertion(
  entry: WorkspaceEntrySearchItem,
  currentValue: string,
  currentSlots: ComposerSlot[],
): WorkspaceMentionInsertion | null {
  if (hasWorkspaceMentionSlot(currentSlots, entry)) return null;

  const needsLeadingSpace = Boolean(currentValue) && !/\s$/u.test(currentValue);
  return {
    // ChatPromptInput cannot reliably replace a trailing text node after multiple imperative
    // insertions. Preserve existing whitespace and only add a separator when needed.
    slots: createWorkspaceMentionSlots(entry, needsLeadingSpace ? ' ' : ''),
  };
}

function selectedSkillIdForSlot(slot: ComposerSlot): string | null {
  const reference = getChatComposerSlotReference(slot);
  return reference?.type === 'skill' ? reference.skillId : null;
}

function createReferenceSlotKey(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function serializedSlotValue(slot: ComposerSlot): string {
  if (slot.type === 'text') return slot.value ?? '';
  if (
    slot.type === 'tag'
    && slot.props
    && 'value' in slot.props
    && typeof slot.props.value === 'string'
  ) return slot.props.value;
  return '';
}

function hasWorkspaceMentionSlot(slots: ComposerSlot[], entry: WorkspaceEntrySearchItem): boolean {
  const resultText = `@${entryLabel(entry)}`;
  return slots.some((slot) => (
    slot.type === 'tag'
    && slot.key.startsWith(workspaceMentionSlotKeyPrefix)
    && slot.props?.value === resultText
  ));
}
