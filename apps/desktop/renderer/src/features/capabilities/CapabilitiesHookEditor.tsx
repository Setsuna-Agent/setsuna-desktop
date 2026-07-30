import type {
  RuntimeHookEventName,
  RuntimeHookInput,
  RuntimeHookMetadata,
} from '@setsuna-desktop/contracts';
import { Loader2, Save } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import {
  Button,
  PageHeader,
  SelectField,
  TextArea,
  TextField,
} from '../../shared/ui/primitives.js';
import { McpFormField } from './mcp/CapabilitiesMcpEditor.js';
import { optionalNumber } from './mcp/mcp-editor-model.js';

export type HookDraft = {
  eventName: RuntimeHookEventName;
  matcher: string;
  command: string;
  commandWindows: string;
  timeoutSec: string;
  statusMessage: string;
};

export const emptyHookDraft: HookDraft = {
  eventName: 'PreToolUse',
  matcher: '',
  command: '',
  commandWindows: '',
  timeoutSec: '600',
  statusMessage: '',
};

const hookEventOptions: Array<{
  value: RuntimeHookEventName;
  labelKey: MessageKey;
  matcher: boolean;
}> = [
  { value: 'PreToolUse', labelKey: 'capabilities.hook.event.preToolUse', matcher: true },
  {
    value: 'PermissionRequest',
    labelKey: 'capabilities.hook.event.permissionRequest',
    matcher: true,
  },
  { value: 'PostToolUse', labelKey: 'capabilities.hook.event.postToolUse', matcher: true },
  { value: 'PreCompact', labelKey: 'capabilities.hook.event.preCompact', matcher: true },
  { value: 'PostCompact', labelKey: 'capabilities.hook.event.postCompact', matcher: true },
  { value: 'SessionStart', labelKey: 'capabilities.hook.event.sessionStart', matcher: true },
  {
    value: 'UserPromptSubmit',
    labelKey: 'capabilities.hook.event.userPromptSubmit',
    matcher: false,
  },
  { value: 'SubagentStart', labelKey: 'capabilities.hook.event.subagentStart', matcher: true },
  { value: 'SubagentStop', labelKey: 'capabilities.hook.event.subagentStop', matcher: true },
  { value: 'Stop', labelKey: 'capabilities.hook.event.stop', matcher: false },
];

export function CapabilitiesHookEditor({
  draft,
  editingHook,
  saving,
  setDraft,
  onBack,
  onSave,
}: {
  draft: HookDraft;
  editingHook: RuntimeHookMetadata | null;
  saving: boolean;
  setDraft: Dispatch<SetStateAction<HookDraft>>;
  onBack: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const selectedEvent = hookEventOptions.find(
    (item) => item.value === draft.eventName,
  ) ?? hookEventOptions[0];
  const setField = <TKey extends keyof HookDraft>(
    key: TKey,
    value: HookDraft[TKey],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="desktop-capabilities-detail desktop-capabilities-hook-editor">
      <PageHeader
        title={t(
          editingHook
            ? 'capabilities.hook.editor.edit'
            : 'capabilities.hook.editor.create',
        )}
        subtitle={t(
          editingHook
            ? 'capabilities.hook.editor.editSubtitle'
            : 'capabilities.hook.editor.createSubtitle',
        )}
        onBack={onBack}
        actions={(
          <>
            <Button type="button" variant="ghost" onClick={onBack}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              icon={saving
                ? <Loader2 size={14} className="is-spinning" />
                : <Save size={14} />}
              disabled={saving || !draft.command.trim()}
              onClick={onSave}
            >
              {t(
                editingHook
                  ? 'capabilities.hook.editor.saveChanges'
                  : 'capabilities.hook.editor.save',
              )}
            </Button>
          </>
        )}
      />
      <div className="desktop-capabilities-hook-form">
        <McpFormField
          className="desktop-capabilities-hook-form__full"
          label={t('capabilities.hook.editor.trigger')}
        >
          <SelectField
            value={draft.eventName}
            onValueChange={(value) => setField(
              'eventName',
              value as RuntimeHookEventName,
            )}
          >
            {hookEventOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {t(item.labelKey)}
              </option>
            ))}
          </SelectField>
        </McpFormField>
        <McpFormField
          className="desktop-capabilities-hook-form__full"
          label="Matcher"
          help={t(
            selectedEvent.matcher
              ? 'capabilities.hook.editor.matcherHelp'
              : 'capabilities.hook.editor.matcherUnused',
          )}
        >
          <TextField
            value={draft.matcher}
            disabled={!selectedEvent.matcher}
            placeholder={t(
              selectedEvent.matcher
                ? 'capabilities.hook.editor.matcherPlaceholder'
                : 'capabilities.hook.editor.notApplicable',
            )}
            onChange={(event) => setField('matcher', event.currentTarget.value)}
          />
        </McpFormField>
        <McpFormField
          className="desktop-capabilities-skill-form__full"
          label={t('capabilities.hook.editor.unixCommand')}
        >
          <TextArea
            rows={3}
            value={draft.command}
            placeholder={t('capabilities.hook.editor.unixPlaceholder')}
            onChange={(event) => setField('command', event.currentTarget.value)}
          />
        </McpFormField>
        <McpFormField
          className="desktop-capabilities-skill-form__full"
          label={t('capabilities.hook.editor.windowsCommand')}
          help={t('capabilities.hook.editor.windowsHelp')}
        >
          <TextArea
            rows={2}
            value={draft.commandWindows}
            placeholder={t('capabilities.hook.editor.windowsPlaceholder')}
            onChange={(event) => setField(
              'commandWindows',
              event.currentTarget.value,
            )}
          />
        </McpFormField>
        <McpFormField label={t('capabilities.hook.editor.timeout')}>
          <TextField
            type="number"
            min="1"
            value={draft.timeoutSec}
            onChange={(event) => setField('timeoutSec', event.currentTarget.value)}
          />
        </McpFormField>
        <McpFormField label={t('capabilities.hook.editor.statusMessage')}>
          <TextField
            value={draft.statusMessage}
            placeholder={t('capabilities.hook.editor.statusPlaceholder')}
            onChange={(event) => setField(
              'statusMessage',
              event.currentTarget.value,
            )}
          />
        </McpFormField>
      </div>
    </div>
  );
}

export function hookDraftFromMetadata(hook: RuntimeHookMetadata): HookDraft {
  return {
    eventName: hookConfigEventName(hook),
    matcher: hook.matcher ?? '',
    command: hook.command ?? '',
    commandWindows: '',
    timeoutSec: String(hook.timeoutSec || 600),
    statusMessage: hook.statusMessage ?? '',
  };
}

export function hookDraftToInput(draft: HookDraft): RuntimeHookInput {
  const eventOption = hookEventOptions.find((item) => item.value === draft.eventName);
  return {
    eventName: draft.eventName,
    command: draft.command.trim(),
    ...(eventOption?.matcher !== false && draft.matcher.trim()
      ? { matcher: draft.matcher.trim() }
      : {}),
    ...(draft.commandWindows.trim()
      ? { commandWindows: draft.commandWindows.trim() }
      : {}),
    ...(optionalNumber(draft.timeoutSec)
      ? { timeoutSec: optionalNumber(draft.timeoutSec) }
      : {}),
    ...(draft.statusMessage.trim()
      ? { statusMessage: draft.statusMessage.trim() }
      : {}),
  };
}

export function hookConfigEventName(
  hook: RuntimeHookMetadata,
): RuntimeHookEventName {
  switch (hook.eventName) {
    case 'preToolUse':
      return 'PreToolUse';
    case 'permissionRequest':
      return 'PermissionRequest';
    case 'postToolUse':
      return 'PostToolUse';
    case 'preCompact':
      return 'PreCompact';
    case 'postCompact':
      return 'PostCompact';
    case 'sessionStart':
      return 'SessionStart';
    case 'userPromptSubmit':
      return 'UserPromptSubmit';
    case 'subagentStart':
      return 'SubagentStart';
    case 'subagentStop':
      return 'SubagentStop';
    case 'stop':
      return 'Stop';
  }
}
