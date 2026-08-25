import { Keyboard, RotateCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../../shared/ui/EditIcon.js';
import type { MessageKey } from '../../../shared/i18n/messages.js';
import {
  captureKeyboardShortcut,
  formatKeyboardShortcutBinding,
  type KeyboardShortcutCaptureError,
} from '../../../shared/shortcuts/keyboardShortcutBindings.js';
import {
  KEYBOARD_SHORTCUT_GROUPS,
  keyboardShortcutCommand,
  keyboardShortcutCommands,
  type KeyboardShortcutCommand,
  type KeyboardShortcutCommandId,
  type KeyboardShortcutGroup,
} from '../../../shared/shortcuts/keyboardShortcutCommands.js';
import { useKeyboardShortcuts } from '../../../shared/shortcuts/KeyboardShortcutsProvider.js';
import { Button } from '../../../shared/ui/primitives.js';

type RecordingTarget = {
  commandId: KeyboardShortcutCommandId;
  index: number | null;
};

const groupLabelKeys: Record<KeyboardShortcutGroup, MessageKey> = {
  general: 'shortcuts.group.general',
  navigation: 'shortcuts.group.navigation',
  chat: 'shortcuts.group.chat',
  workspace: 'shortcuts.group.workspace',
};

const captureErrorKeys: Record<KeyboardShortcutCaptureError, MessageKey> = {
  'alt-graph': 'shortcuts.capture.altGraph',
  'modifier-required': 'shortcuts.capture.modifierRequired',
  reserved: 'shortcuts.capture.reserved',
  unsupported: 'shortcuts.capture.unsupported',
};

export function KeyboardShortcutsSettings() {
  const { t } = useI18n();
  const {
    bindingsFor,
    commandForBinding,
    isOverridden,
    platform,
    resetAll,
    resetCommand,
    setBindings,
    setRecording: setShortcutRecording,
  } = useKeyboardShortcuts();
  const [query, setQuery] = useState('');
  const [recordingTarget, setRecordingTarget] = useState<RecordingTarget | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingCommands = useMemo(() => keyboardShortcutCommands.filter((command) => {
    if (!normalizedQuery) return true;
    const searchable = [
      t(command.labelKey),
      t(command.descriptionKey),
      ...bindingsFor(command.id).map((binding) => formatKeyboardShortcutBinding(binding, platform)),
    ].join(' ').toLocaleLowerCase();
    return searchable.includes(normalizedQuery);
  }), [bindingsFor, normalizedQuery, platform, t]);

  useEffect(() => {
    setShortcutRecording(Boolean(recordingTarget));
    return () => setShortcutRecording(false);
  }, [recordingTarget, setShortcutRecording]);

  const stopRecording = useCallback(() => {
    setRecordingTarget(null);
    setCaptureError(null);
  }, []);

  const beginRecording = useCallback((commandId: KeyboardShortcutCommandId, index: number | null) => {
    setCaptureError(null);
    setRecordingTarget({ commandId, index });
  }, []);

  const removeBinding = useCallback((commandId: KeyboardShortcutCommandId, index: number) => {
    setBindings(commandId, bindingsFor(commandId).filter((_, bindingIndex) => bindingIndex !== index));
    if (recordingTarget?.commandId === commandId && recordingTarget.index === index) stopRecording();
  }, [bindingsFor, recordingTarget, setBindings, stopRecording]);

  const recordShortcut = useCallback((event: KeyboardEvent, target: RecordingTarget) => {
    event.preventDefault();
    event.stopPropagation();
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

    const result = captureKeyboardShortcut(event, platform);
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
    const conflictingCommandId = commandForBinding(result.binding, target.commandId);
    if (conflictingCommandId) {
      const confirmed = window.confirm(t('shortcuts.capture.conflict', {
        command: t(keyboardShortcutCommand(conflictingCommandId).labelKey),
        shortcut: formatKeyboardShortcutBinding(result.binding, platform),
      }));
      if (!confirmed) return;
      setBindings(
        conflictingCommandId,
        bindingsFor(conflictingCommandId).filter((binding) => binding !== result.binding),
      );
    }

    if (target.index === null) currentBindings.push(result.binding);
    else currentBindings[target.index] = result.binding;
    setBindings(target.commandId, currentBindings);
    stopRecording();
  }, [bindingsFor, commandForBinding, platform, removeBinding, setBindings, stopRecording, t]);

  useEffect(() => {
    if (!recordingTarget) return undefined;
    // Keep recording at the window level so a focus change cannot leave the UI
    // in recording mode while making keyboard input impossible to capture.
    const handleKeyDown = (event: KeyboardEvent) => recordShortcut(event, recordingTarget);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordShortcut, recordingTarget]);

  return (
    <div className="chat-user-settings__section settings-shortcuts">
      <div className="settings-shortcuts__toolbar">
        <label className="settings-shortcuts__search">
          <Search size={14} aria-hidden="true" />
          <input
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
          onClick={() => {
            if (!window.confirm(t('shortcuts.resetAllConfirm'))) return;
            resetAll();
            stopRecording();
          }}
        >
          {t('shortcuts.resetAll')}
        </Button>
      </div>

      {matchingCommands.length ? KEYBOARD_SHORTCUT_GROUPS.map((group) => {
        const commands = matchingCommands.filter((command) => command.group === group);
        if (!commands.length) return null;
        return (
          <section className="settings-shortcuts__group" key={group}>
            <h2>{t(groupLabelKeys[group])}</h2>
            <div className="settings-shortcuts__list">
              {commands.map((command) => {
                const commandRecordingTarget = recordingTarget?.commandId === command.id
                  ? recordingTarget
                  : null;
                return (
                  <KeyboardShortcutRow
                    bindings={bindingsFor(command.id)}
                    captureError={commandRecordingTarget ? captureError : null}
                    command={command}
                    key={command.id}
                    overridden={isOverridden(command.id)}
                    platform={platform}
                    recordingIndex={commandRecordingTarget?.index}
                    onAdd={() => beginRecording(command.id, null)}
                    onEdit={(index) => beginRecording(command.id, index)}
                    onRemove={(index) => removeBinding(command.id, index)}
                    onReset={() => {
                      resetCommand(command.id);
                      if (commandRecordingTarget) stopRecording();
                    }}
                  />
                );
              })}
            </div>
          </section>
        );
      }) : <div className="settings-shortcuts__empty">{t('shortcuts.emptySearch')}</div>}
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
  command: KeyboardShortcutCommand;
  overridden: boolean;
  platform: ReturnType<typeof useKeyboardShortcuts>['platform'];
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
        <small>{t(command.descriptionKey)}</small>
      </span>
      <span className="settings-shortcuts__bindings">
        <span className="settings-shortcuts__values">
          {!bindings.length && !adding ? <em>{t('shortcuts.unbound')}</em> : null}
          {bindings.map((binding, index) => {
            const label = formatKeyboardShortcutBinding(binding, platform);
            if (recordingIndex === index) {
              return (
                <span className="settings-shortcuts__binding settings-shortcuts__binding--recording" key={`${binding}:recording`}>
                  <span className="settings-shortcuts__binding-key-placeholder" aria-hidden="true">
                    <kbd>{label}</kbd>
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
                <button
                  className="settings-shortcuts__binding-key"
                  type="button"
                  onClick={() => onEdit(index)}
                  aria-label={t('shortcuts.edit', { shortcut: label })}
                >
                  <kbd>{label}</kbd>
                </button>
                <button
                  className="settings-shortcuts__binding-remove"
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={t('shortcuts.remove', { shortcut: label })}
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </span>
        <span className="settings-shortcuts__actions">
          {adding ? (
            <ShortcutRecorder mode="icon" />
          ) : (
            <button
              className="settings-shortcuts__add"
              type="button"
              aria-label={t('shortcuts.add')}
              disabled={recordingIndex !== undefined}
              title={t('shortcuts.add')}
              onClick={onAdd}
            >
              <EditIcon size={13} />
            </button>
          )}
          <button
            className="settings-shortcuts__reset"
            type="button"
            aria-label={t('shortcuts.resetCommand')}
            disabled={!overridden || recordingIndex !== undefined}
            title={t('shortcuts.resetCommand')}
            onClick={onReset}
          >
            <RotateCcw size={13} />
          </button>
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

function ShortcutRecorder({ mode }: {
  mode: 'binding' | 'icon';
}) {
  const { t } = useI18n();
  return (
    <button
      autoFocus
      className={`settings-shortcuts__recorder settings-shortcuts__recorder--${mode}`}
      type="button"
      aria-label={t('shortcuts.recording')}
      title={mode === 'icon' ? t('shortcuts.recording') : undefined}
    >
      {mode === 'icon' ? <Keyboard size={13} /> : t('shortcuts.recordingCompact')}
    </button>
  );
}
