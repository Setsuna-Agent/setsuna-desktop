import {
  TextField, Button, captureKeyboardShortcut, formatKeyboardShortcutBinding, formatKeyboardShortcutBindingParts,
  useConfirm, type KeyboardShortcutCaptureError, type KeyboardShortcutConflict,
} from '@setsuna-desktop/renderer-ui';
import { Keyboard, RotateCcw, Search, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../../shared/ui/EditIcon.js';
import type { MessageKey } from '../../../shared/i18n/messages.js';
import {
  KEYBOARD_SHORTCUT_GROUPS,
  keyboardShortcutCommands,
  type KeyboardShortcutGroup,
  type KeyboardShortcutPlatform,
} from '../../../shared/shortcuts/keyboardShortcutCommands.js';
import { searchKeyboardShortcuts, type SearchableShortcut } from '../../../shared/shortcuts/keyboardShortcutSearch.js';
import { useKeyboardShortcuts } from '../../../shared/shortcuts/KeyboardShortcutsProvider.js';
import '../styles/settings-shortcuts.css';

type RecordingTarget<Id extends string> = {
  commandId: Id;
  index: number | null;
};

type ShortcutEditorCommand<Id extends string> = SearchableShortcut<Id> & { group?: KeyboardShortcutGroup };
type ShortcutEditorProps<Id extends string> = {
  className?: string;
  commands: readonly ShortcutEditorCommand<Id>[];
  groups?: readonly KeyboardShortcutGroup[];
  bindingsFor(commandId: Id): readonly string[];
  isOverridden(commandId: Id): boolean;
  platform: KeyboardShortcutPlatform;
  resetAll(): void;
  resetCommand(commandId: Id): void;
  setBindings(commandId: Id, bindings: readonly string[], conflict?: KeyboardShortcutConflict<Id>): void;
  allowUnmodifiedKeys?: boolean;
  blockedBindingReason?(binding: string): string | undefined;
  resetConfirmationTitle?: string;
};

const captureErrorKeys: Record<KeyboardShortcutCaptureError, MessageKey> = {
  'alt-graph': 'shortcuts.capture.altGraph',
  'modifier-required': 'shortcuts.capture.modifierRequired',
  reserved: 'shortcuts.capture.reserved',
  unsupported: 'shortcuts.capture.unsupported',
};

export function KeyboardShortcutsSettings() {
  const shortcuts = useKeyboardShortcuts();
  return <KeyboardShortcutEditor {...shortcuts} commands={keyboardShortcutCommands} groups={KEYBOARD_SHORTCUT_GROUPS} />;
}

export function KeyboardShortcutEditor<Id extends string>({
  className, commands, groups, bindingsFor, isOverridden, platform, resetAll, resetCommand, setBindings,
  allowUnmodifiedKeys = false, blockedBindingReason, resetConfirmationTitle,
}: ShortcutEditorProps<Id>) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { setRecording: setShortcutRecording } = useKeyboardShortcuts();
  const [query, setQuery] = useState('');
  const [recordingTarget, setRecordingTarget] = useState<RecordingTarget<Id> | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const matchingCommands = useMemo(() => searchKeyboardShortcuts(commands, query, { bindingsFor, platform, translate: t }),
    [bindingsFor, commands, platform, query, t]);

  useEffect(() => {
    setShortcutRecording(Boolean(recordingTarget));
    return () => setShortcutRecording(false);
  }, [recordingTarget, setShortcutRecording]);

  const stopRecording = useCallback(() => {
    setRecordingTarget(null);
    setCaptureError(null);
  }, []);

  const beginRecording = useCallback((commandId: Id, index: number | null) => {
    setCaptureError(null);
    setRecordingTarget({ commandId, index });
  }, []);

  const removeBinding = useCallback((commandId: Id, index: number) => {
    setBindings(commandId, bindingsFor(commandId).filter((_, bindingIndex) => bindingIndex !== index));
    if (recordingTarget?.commandId === commandId && recordingTarget.index === index) stopRecording();
  }, [bindingsFor, recordingTarget, setBindings, stopRecording]);

  const recordShortcut = useCallback(async (event: KeyboardEvent, target: RecordingTarget<Id>) => {
    // Preserve native focus navigation, including reverse navigation with Shift.
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      stopRecording();
      return;
    }
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.key === 'Escape') {
      stopRecording();
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete')
      && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      if (target.index !== null) removeBinding(target.commandId, target.index);
      else stopRecording();
      return;
    }

    const result = captureKeyboardShortcut(event, platform, allowUnmodifiedKeys);
    if (result.status === 'pending') return;
    if (result.status === 'invalid') {
      setCaptureError(t(captureErrorKeys[result.reason]));
      return;
    }

    const currentBindings = [...bindingsFor(target.commandId)];
    if (currentBindings.some((binding, index) => binding === result.binding && index !== target.index)) {
      setCaptureError(t('shortcuts.capture.duplicate'));
      return;
    }
    if (target.index !== null && currentBindings[target.index] === result.binding) {
      stopRecording();
      return;
    }
    const blocked = blockedBindingReason?.(result.binding);
    if (blocked) { setCaptureError(blocked); return; }
    const conflictingCommand = commands.find((command) => command.id !== target.commandId && bindingsFor(command.id).includes(result.binding));
    if (conflictingCommand) {
      // Release keyboard capture before the modal takes focus so Tab/Escape remain usable.
      stopRecording();
      const confirmed = await confirm({
        title: t('shortcuts.capture.replace'),
        description: t('shortcuts.capture.conflict', {
          command: t(conflictingCommand.labelKey),
          shortcut: formatKeyboardShortcutBinding(result.binding, platform),
        }),
        confirmLabel: t('shortcuts.capture.replace'),
      });
      if (!confirmed) return;
    }

    if (target.index === null) currentBindings.push(result.binding);
    else currentBindings[target.index] = result.binding;
    setBindings(target.commandId, currentBindings, conflictingCommand && { commandId: conflictingCommand.id, binding: result.binding });
    stopRecording();
  }, [allowUnmodifiedKeys, bindingsFor, blockedBindingReason, commands, confirm, platform, removeBinding, setBindings, stopRecording, t]);

  useEffect(() => {
    if (!recordingTarget) return undefined;
    // Keep recording at the window level so a focus change cannot leave the UI
    // in recording mode while making keyboard input impossible to capture.
    const handleKeyDown = (event: KeyboardEvent) => { void recordShortcut(event, recordingTarget); };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordShortcut, recordingTarget]);

  const renderCommands = (items: readonly ShortcutEditorCommand<Id>[]) => (
    <div className="settings-shortcuts__list">
      {items.map((command) => {
        const target = recordingTarget?.commandId === command.id ? recordingTarget : null;
        return <KeyboardShortcutRow
          bindings={bindingsFor(command.id)}
          captureError={target ? captureError : null}
          command={command}
          key={command.id}
          overridden={isOverridden(command.id)}
          platform={platform}
          recordingIndex={target?.index}
          onAdd={() => beginRecording(command.id, null)}
          onEdit={(index) => beginRecording(command.id, index)}
          onRemove={(index) => removeBinding(command.id, index)}
          onReset={() => {
            resetCommand(command.id);
            if (target) stopRecording();
          }}
        />;
      })}
    </div>
  );

  return (
    <div className={`chat-user-settings__section settings-shortcuts${className ? ` ${className}` : ''}`}>
      <div className="settings-shortcuts__toolbar">
        <label className="settings-shortcuts__search">
          <Search size={14} aria-hidden="true" />
          <TextField
            type="search"
            value={query}
            placeholder={t('shortcuts.search')}
            aria-label={t('shortcuts.search')}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={stopRecording}
          />
        </label>
        <Button
          className="settings-shortcuts__reset-all"
          icon={<RotateCcw size={13} />}
          onClick={async () => {
            stopRecording();
            if (!await confirm({ title: resetConfirmationTitle ?? t('shortcuts.resetAllConfirm'), confirmLabel: t('shortcuts.resetAll') })) return;
            resetAll();
            stopRecording();
          }}
        >
          {t('shortcuts.resetAll')}
        </Button>
      </div>

      {matchingCommands.length ? groups ? groups.map((group) => {
        const items = matchingCommands.filter((command) => command.group === group);
        if (!items.length) return null;
        return (
          <section className="settings-shortcuts__group" key={group}>
            <h2>{t(`shortcuts.group.${group}`)}</h2>
            {renderCommands(items)}
          </section>
        );
      }) : renderCommands(matchingCommands) : <div className="settings-shortcuts__empty">{t('shortcuts.emptySearch')}</div>}
    </div>
  );
}

function KeyboardShortcutRow({
  bindings,
  captureError,
  command,
  overridden,
  platform,
  recordingIndex,
  onAdd,
  onEdit,
  onRemove,
  onReset,
}: {
  bindings: readonly string[];
  captureError: string | null;
  command: SearchableShortcut<string>;
  overridden: boolean;
  platform: KeyboardShortcutPlatform;
  recordingIndex: number | null | undefined;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const adding = recordingIndex === null;
  return (
    <article className="settings-shortcuts__row">
      <span className="settings-shortcuts__copy">
        <strong>{t(command.labelKey)}</strong>
        {command.descriptionKey ? <small>{t(command.descriptionKey)}</small> : null}
      </span>
      <span className="settings-shortcuts__bindings">
        <span className="settings-shortcuts__values">
          {!bindings.length && !adding ? <em>{t('shortcuts.unbound')}</em> : null}
          {bindings.map((binding, index) => {
            const parts = formatKeyboardShortcutBindingParts(binding, platform);
            const label = parts.join(' + ');
            if (recordingIndex === index) {
              return (
                <span className="settings-shortcuts__binding settings-shortcuts__binding--recording" key={`${binding}:recording`}>
                  <span className="settings-shortcuts__binding-key-placeholder" aria-hidden="true">
                    <ShortcutKeys parts={parts} />
                  </span>
                  <span className="settings-shortcuts__binding-remove-placeholder" aria-hidden="true">
                    <X size={12} />
                  </span>
                  <ShortcutRecorder mode="binding" />
                </span>
              );
            }
            return (
              <span className="settings-shortcuts__binding" key={binding}>
                <Button variant="ghost"
                  className="settings-shortcuts__binding-key"
                  type="button"
                  onClick={() => onEdit(index)}
                  aria-label={t('shortcuts.edit', { shortcut: label })}
                >
                  <ShortcutKeys parts={parts} />
                </Button>
                <Button variant="ghost"
                  className="settings-shortcuts__binding-remove"
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={t('shortcuts.remove', { shortcut: label })}
                >
                  <X size={12} />
                </Button>
              </span>
            );
          })}
        </span>
        <span className="settings-shortcuts__actions">
          {adding ? (
            <ShortcutRecorder mode="icon" />
          ) : (
            <Button variant="ghost"
              className="settings-shortcuts__add"
              type="button"
              aria-label={t('shortcuts.add')}
              disabled={recordingIndex !== undefined}
              title={t('shortcuts.add')}
              onClick={onAdd}
            >
              <EditIcon size={13} />
            </Button>
          )}
          <Button variant="ghost"
            className="settings-shortcuts__reset"
            type="button"
            aria-label={t('shortcuts.resetCommand')}
            disabled={!overridden || recordingIndex !== undefined}
            title={t('shortcuts.resetCommand')}
            onClick={onReset}
          >
            <RotateCcw size={13} />
          </Button>
        </span>
      </span>
      {recordingIndex !== undefined ? (
        <small className={`settings-shortcuts__capture-message ${captureError ? 'is-error' : ''}`}>
          {captureError ?? t('shortcuts.recordingHint')}
        </small>
      ) : null}
    </article>
  );
}

function ShortcutKeys({ parts }: { parts: readonly string[] }) {
  return <kbd>{parts.map((part, index) => <Fragment key={`${part}:${index}`}>
    {index ? <span className="settings-shortcuts__key-separator"> + </span> : null}
    <span className="settings-shortcuts__keycap">{part}</span>
  </Fragment>)}</kbd>;
}

function ShortcutRecorder({ mode }: {
  mode: 'binding' | 'icon';
}) {
  const { t } = useI18n();
  return (
    <Button variant="ghost"
      autoFocus
      className={`settings-shortcuts__recorder settings-shortcuts__recorder--${mode}`}
      type="button"
      aria-label={t('shortcuts.recording')}
      title={mode === 'icon' ? t('shortcuts.recording') : undefined}
    >
      {mode === 'icon' ? <Keyboard size={13} /> : t('shortcuts.recordingCompact')}
    </Button>
  );
}
