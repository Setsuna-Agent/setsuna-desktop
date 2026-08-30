import type { SettingsDirectoryListProps } from '@setsuna-desktop/renderer-contracts/settings';
import { Check, Folder, FolderOpen, Plus, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider.js';
import { Button, IconButton } from './primitives.js';

const EMPTY_DIRECTORY_PRESETS: NonNullable<SettingsDirectoryListProps['presets']> = Object.freeze([]);

/**
 * Host-owned directory picker used by settings Features. Keeping native path
 * selection here prevents Feature views from accepting hand-entered paths or
 * reaching through the preload bridge themselves.
 */
export function SettingsDirectoryList({
  description,
  formatPresetCount,
  inspectDirectories,
  label,
  onSave,
  presetAddLabel,
  presetRemoveLabel,
  presets = EMPTY_DIRECTORY_PRESETS,
  value,
}: SettingsDirectoryListProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeDirectory, setHomeDirectory] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [inspectionCounts, setInspectionCounts] = useState<ReadonlyMap<string, number> | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const hasHomePresets = presets.length > 0;
  const platform = typeof window === 'undefined'
    ? ''
    : window.setsunaDesktop?.desktop.platform ?? '';

  useEffect(() => {
    if (!hasHomePresets) return undefined;
    const desktop = window.setsunaDesktop?.desktop;
    if (!desktop?.getUserProfile) {
      setPresetError(t('settings.runtime.homeDirectoryUnavailable'));
      return undefined;
    }
    let active = true;
    void desktop.getUserProfile().then((profile) => {
      if (!active) return;
      if (profile.homeDir) {
        setHomeDirectory(profile.homeDir);
        setPresetError(null);
      } else {
        setPresetError(t('settings.runtime.homeDirectoryUnavailable'));
      }
    }).catch(() => {
      if (active) setPresetError(t('settings.runtime.homeDirectoryUnavailable'));
    });
    return () => {
      active = false;
    };
  }, [hasHomePresets, t]);

  useEffect(() => {
    if (!homeDirectory || !hasHomePresets || !inspectDirectories) return undefined;
    const paths = presets.map((preset) => (
      resolveHomeDirectory(homeDirectory, preset.homeRelativePath, platform)
    ));
    let active = true;
    void inspectDirectories(paths).then((directories) => {
      if (!active) return;
      setInspectionCounts(new Map(directories.map((directory) => [
        normalizeDirectory(directory.path, platform),
        directory.count,
      ])));
      setInspectionError(null);
    }).catch(() => {
      if (active) setInspectionError(t('settings.runtime.directoryScanError'));
    });
    return () => {
      active = false;
    };
  }, [hasHomePresets, homeDirectory, inspectDirectories, platform, presets, t]);

  const commit = async (items: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(items);
      return true;
    } catch (unknownError) {
      setError(errorMessage(unknownError, t('settings.runtime.saveError', { label })));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addDirectory = async () => {
    const api = window.setsunaDesktop?.desktop;
    if (!api?.selectDirectory) {
      setError(t('settings.runtime.selectUnsupported'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const selected = await api.selectDirectory({
        title: t('settings.runtime.selectLabel', { label }),
      });
      if (selected && !value.some((item) => sameDirectory(item, selected, platform))) {
        await onSave([...value, selected]);
      }
    } catch (unknownError) {
      setError(errorMessage(unknownError, t('settings.runtime.addError', { label })));
    } finally {
      setBusy(false);
    }
  };

  const resolvedPresets = presets.map((preset) => {
    const path = homeDirectory
      ? resolveHomeDirectory(homeDirectory, preset.homeRelativePath, platform)
      : null;
    const inherited = Boolean(path && value.some((item) => sameDirectory(item, path, platform)));
    return {
      ...preset,
      count: path ? inspectionCounts?.get(normalizeDirectory(path, platform)) : undefined,
      displayPath: path ?? `~/${preset.homeRelativePath.join('/')}`,
      inherited,
      path,
    };
  });
  const visiblePresets = resolvedPresets.filter((preset) => (
    preset.inherited || !inspectDirectories || (preset.count ?? 0) > 0
  ));
  const customItems = value.filter((item) => !resolvedPresets.some((preset) => (
    preset.path && sameDirectory(item, preset.path, platform)
  )));
  const presetRows = visiblePresets.length ? (
    <div className="chat-user-settings__runtime-directory-presets">
      {visiblePresets.map((preset) => {
        const actionLabel = preset.inherited
          ? presetRemoveLabel ?? t('common.remove')
          : presetAddLabel ?? t('common.add');
        const actionAriaLabel = `${actionLabel} ${preset.label}`;
        const togglePreset = () => {
          if (!preset.path) return;
          const nextItems = preset.inherited
            ? value.filter((item) => !sameDirectory(item, preset.path ?? '', platform))
            : [...value, preset.path];
          void commit(nextItems);
        };
        return (
          <div
            className={`chat-user-settings__runtime-directory-preset${preset.inherited ? ' is-inherited' : ''}`}
            key={preset.id}
          >
            <span className="chat-user-settings__runtime-directory-preset-icon" aria-hidden="true">
              {preset.inherited ? <Check size={14} /> : <Folder size={14} />}
            </span>
            <span className="chat-user-settings__runtime-directory-preset-copy">
              <strong>
                <span>{preset.label}</span>
                {preset.count !== undefined ? (
                  <span className="chat-user-settings__runtime-directory-preset-count">
                    {formatPresetCount?.(preset.count) ?? String(preset.count)}
                  </span>
                ) : null}
              </strong>
              <code title={preset.displayPath}>{preset.displayPath}</code>
            </span>
            <button
              aria-label={actionAriaLabel}
              className="chat-user-settings__runtime-directory-preset-action"
              disabled={busy || !preset.path}
              type="button"
              onClick={togglePreset}
            >
              {preset.inherited ? <X aria-hidden="true" size={13} /> : <Plus aria-hidden="true" size={13} />}
              <span>{actionLabel}</span>
            </button>
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <SettingsListEditor
      action={(
        <Button
          disabled={busy}
          icon={<FolderOpen size={14} />}
          onClick={() => void addDirectory()}
        >
          {busy ? t('common.processing') : t('settings.runtime.addDirectory')}
        </Button>
      )}
      busy={busy}
      description={description}
      error={error ?? presetError ?? inspectionError}
      items={customItems}
      label={label}
      onRemove={(item) => void commit(value.filter((current) => current !== item))}
      showEmpty={!hasHomePresets}
    >
      {presetRows}
    </SettingsListEditor>
  );
}

export function SettingsListEditor({
  action,
  busy,
  description,
  error,
  items,
  label,
  onRemove,
  showEmpty = true,
  children,
}: Readonly<{
  action: ReactNode;
  busy: boolean;
  children?: ReactNode;
  description: string;
  error: string | null;
  items: readonly string[];
  label: string;
  onRemove(item: string): void;
  showEmpty?: boolean;
}>) {
  const { t } = useI18n();
  return (
    <div className="chat-user-settings__runtime-list-editor">
      <div className="chat-user-settings__runtime-list-head">
        <span className="chat-user-settings__runtime-list-copy">
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
        {action}
      </div>
      {children}
      {items.length ? (
        <div className="chat-user-settings__runtime-list-items">
          {items.map((item) => (
            <div className="chat-user-settings__runtime-list-item" key={item}>
              <code title={item}>{item}</code>
              <IconButton
                disabled={busy}
                label={t('settings.runtime.removeLabel', { item })}
                onClick={() => onRemove(item)}
              >
                <X size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : !children && showEmpty ? (
        <span className="chat-user-settings__runtime-list-empty">{t('common.noneAdded')}</span>
      ) : null}
      {error ? <span className="chat-user-settings__runtime-list-error" role="alert">{error}</span> : null}
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function resolveHomeDirectory(
  homeDirectory: string,
  relativePath: readonly string[],
  platform: string,
): string {
  const separator = platform === 'win32' ? '\\' : '/';
  return [homeDirectory.replace(/[\\/]+$/u, ''), ...relativePath].join(separator);
}

function sameDirectory(left: string, right: string, platform: string): boolean {
  return normalizeDirectory(left, platform) === normalizeDirectory(right, platform);
}

function normalizeDirectory(value: string, platform: string): string {
  const separator = platform === 'win32' ? '\\' : '/';
  const normalized = value.replace(/[\\/]+/gu, separator).replace(/[\\/]+$/u, '');
  return platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}
