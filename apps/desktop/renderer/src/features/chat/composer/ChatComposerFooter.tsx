import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { Button, Dropdown } from 'antd';
import {
  ArrowUp,
  Check,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import type {
  ComponentProps,
  ReactNode,
} from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { RuntimeAccessModeSelection } from '../../../shared/lib/runtimeAccessMode.js';
import { ShortcutTooltip } from '../../../shared/ui/ShortcutTooltip.js';
import type { ChatContextTokenUsage } from '../conversation/chatContextUsage.js';
import { ChatApprovalPolicyMenu } from './ChatApprovalPolicyMenu.js';
import { ChatModelPicker } from './ChatModelPicker.js';
import type { ChatThinkingConfig } from './chatComposerModeState.js';

type ChatComposerFooterCommandControl = {
  active: boolean;
  disabled: boolean;
  onOpen: () => void;
};

type ChatComposerFooterAttachmentControl = {
  disabled: boolean;
  onOpen: () => void;
};

type ChatComposerFooterEditingControl = {
  active: boolean;
  disabled: boolean;
  onCancel: () => void;
};

type ChatComposerFooterModeBadges = {
  collaborationEnabled: boolean;
  goalModeEnabled: boolean;
  onClearGoal: () => void;
  onClearReview: () => void;
  onDisableCollaboration: () => void;
  reviewModeEnabled: boolean;
};

type ChatComposerFooterPrimaryAction = {
  attachmentOnlyReady: boolean;
  attachmentsBusy: boolean;
  queueReady: boolean;
  submitting: boolean;
  onCancelActiveTurn: () => void;
  onSubmit: () => void;
};

type ChatComposerFooterThinkingControl = {
  config: ChatThinkingConfig;
  disabled: boolean;
  effort: string;
  enabled: boolean;
  menuOpen: boolean;
  onEffortChange: (effort: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onMenuOpenChange: (open: boolean) => void;
};

export function ChatComposerFooter({
  attachmentControl,
  commandControl,
  config,
  contextCompacting,
  contextUsage,
  editingControl,
  hasActiveTurn,
  modeBadges,
  modelOpenSignal,
  primaryAction,
  senderActions,
  thinkingControl,
  onAccessModeChange,
  onSelectModel,
}: {
  attachmentControl: ChatComposerFooterAttachmentControl;
  commandControl: ChatComposerFooterCommandControl;
  config: RuntimeConfigState | null;
  contextCompacting: boolean;
  contextUsage: ChatContextTokenUsage;
  editingControl: ChatComposerFooterEditingControl;
  hasActiveTurn: boolean;
  modeBadges: ChatComposerFooterModeBadges;
  modelOpenSignal: number;
  primaryAction: ChatComposerFooterPrimaryAction;
  senderActions: ReactNode;
  thinkingControl: ChatComposerFooterThinkingControl;
  onAccessModeChange: (selection: RuntimeAccessModeSelection) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="chat-sender__footer">
      <div className="chat-sender__left-actions">
        <button
          className={`chat-sender-icon-button chat-sender-command-button ${commandControl.active ? 'is-active' : ''}`}
          type="button"
          disabled={commandControl.disabled}
          aria-label={t('chat.composer.openCommands')}
          title={t('chat.composer.openCommands')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={commandControl.onOpen}
        >
          <Plus size={14} />
        </button>
        <ChatThinkingMenu
          disabled={thinkingControl.disabled}
          enabled={thinkingControl.enabled}
          menuOpen={thinkingControl.menuOpen}
          thinkingConfig={thinkingControl.config}
          value={thinkingControl.effort}
          onEnabledChange={thinkingControl.onEnabledChange}
          onMenuOpenChange={thinkingControl.onMenuOpenChange}
          onValueChange={thinkingControl.onEffortChange}
        />
        <ChatApprovalPolicyMenu
          approvalPolicy={config?.approvalPolicy ?? 'on-request'}
          permissionProfile={config?.permissionProfile ?? 'workspace-write'}
          onChange={onAccessModeChange}
        />
        {editingControl.active ? (
          <ChatModeBadge
            disabled={editingControl.disabled}
            label={t('chat.queue.editing')}
            onClose={editingControl.onCancel}
          />
        ) : null}
        {modeBadges.collaborationEnabled ? (
          <ChatModeBadge
            label={t('chat.composer.badge.collaboration')}
            onClose={modeBadges.onDisableCollaboration}
          />
        ) : null}
        {modeBadges.goalModeEnabled ? (
          <ChatModeBadge
            label={hasActiveTurn
              ? t('chat.composer.badge.goalNext')
              : t('chat.composer.badge.goal')}
            onClose={modeBadges.onClearGoal}
          />
        ) : null}
        {modeBadges.reviewModeEnabled ? (
          <ChatModeBadge
            label={t('chat.composer.badge.review')}
            onClose={modeBadges.onClearReview}
          />
        ) : null}
      </div>
      <div className="chat-sender__right-actions">
        <button
          className="chat-sender-icon-button"
          type="button"
          aria-label={t('chat.composer.uploadAttachment')}
          title={t('chat.composer.uploadAttachmentHint')}
          disabled={attachmentControl.disabled}
          onClick={attachmentControl.onOpen}
        >
          <Paperclip size={13} />
        </button>
        <span className="chat-sender-divider" aria-hidden="true" />
        <ChatModelPicker
          config={config}
          contextCompacting={contextCompacting}
          contextUsage={contextUsage}
          openSignal={modelOpenSignal}
          onSelect={onSelectModel}
        />
        <span className="chat-sender-divider" aria-hidden="true" />
        <ChatComposerPrimaryAction
          hasActiveTurn={hasActiveTurn}
          primaryAction={primaryAction}
          senderActions={senderActions}
        />
      </div>
    </div>
  );
}

function ChatComposerPrimaryAction({
  hasActiveTurn,
  primaryAction,
  senderActions,
}: {
  hasActiveTurn: boolean;
  primaryAction: ChatComposerFooterPrimaryAction;
  senderActions: ReactNode;
}) {
  const { t } = useI18n();

  if (primaryAction.queueReady) {
    return (
      <button
        className="chat-sender-attachment-submit"
        type="button"
        aria-label={t('chat.composer.queue')}
        title={t('chat.composer.queue')}
        disabled={primaryAction.attachmentsBusy || primaryAction.submitting}
        onClick={primaryAction.onSubmit}
      >
        <ArrowUp size={16} />
      </button>
    );
  }

  if (hasActiveTurn) {
    return (
      <ShortcutTooltip commandId="chat.cancelTurn" label={t('chat.composer.stop')}>
        <button
          className="chat-sender-stop"
          type="button"
          aria-label={t('chat.composer.stop')}
          onClick={primaryAction.onCancelActiveTurn}
        >
          <Square size={11} />
        </button>
      </ShortcutTooltip>
    );
  }

  if (primaryAction.attachmentOnlyReady) {
    return (
      <button
        className="chat-sender-attachment-submit"
        type="button"
        aria-label={t('chat.composer.send')}
        disabled={primaryAction.attachmentsBusy || primaryAction.submitting}
        onClick={primaryAction.onSubmit}
      >
        <ArrowUp size={16} />
      </button>
    );
  }

  return senderActions;
}

function ChatModeBadge({
  disabled = false,
  label,
  onClose,
}: {
  disabled?: boolean;
  label: string;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <button className="chat-sender-plan-badge" type="button" disabled={disabled} aria-label={t('chat.composer.closeBadge', { label })} title={t('chat.composer.closeBadge', { label })} onClick={onClose}>
      <span className="chat-sender-plan-badge__dot" aria-hidden="true" />
      <span className="chat-sender-plan-badge__label">{label}</span>
      <X className="chat-sender-plan-badge__close" size={11} aria-hidden="true" />
    </button>
  );
}

function ChatThinkingMenu({
  disabled,
  enabled,
  menuOpen,
  thinkingConfig,
  value,
  onEnabledChange,
  onMenuOpenChange,
  onValueChange,
}: {
  disabled?: boolean;
  enabled: boolean;
  menuOpen: boolean;
  thinkingConfig: ChatThinkingConfig;
  value: string;
  onEnabledChange: (enabled: boolean) => void;
  onMenuOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const hasEfforts = thinkingConfig.efforts.length > 0;
  const currentEffort = value && thinkingConfig.efforts.includes(value) ? value : thinkingConfig.defaultEffort;

  if (!thinkingConfig.supported) return null;

  const thinkingLabel = enabled ? (currentEffort ? formatThinkingEffort(currentEffort, t('chat.composer.thinking')) : t('chat.composer.thinking')) : '';
  const selectedThinkingKey = enabled && currentEffort ? currentEffort : 'off';
  const renderThinkingMenuItem = (label: string, active: boolean) => (
    <span className="chat-thinking-menu__item">
      <span className="chat-thinking-menu__icon" />
      <span>{label}</span>
      <span className="chat-thinking-menu__check">{active ? <Check size={13} /> : null}</span>
    </span>
  );
  const items: NonNullable<ComponentProps<typeof Dropdown>['menu']>['items'] = [
    {
      key: 'off',
      label: renderThinkingMenuItem(t('chat.composer.thinkingOff'), !enabled),
    },
    ...thinkingConfig.efforts.map((effort) => ({
      key: effort,
      label: renderThinkingMenuItem(formatThinkingEffort(effort, t('chat.composer.thinking')), enabled && currentEffort === effort),
    })),
  ];
  const thinkingSwitch = (
    <Button
      type="text"
      size="small"
      className="chat-thinking-switch"
      disabled={disabled}
      aria-pressed={enabled}
      onClick={hasEfforts ? undefined : () => onEnabledChange(!enabled)}
    >
      <Sparkles className="chat-thinking-switch__icon" size={13} />
      {thinkingLabel ? <span className="chat-thinking-switch__label">{thinkingLabel}</span> : null}
    </Button>
  );

  if (!hasEfforts) return thinkingSwitch;

  return (
    <Dropdown
      rootClassName="chat-thinking-menu-root"
      trigger={['click']}
      placement="topLeft"
      disabled={disabled}
      open={menuOpen}
      menu={{
        items,
        selectedKeys: [selectedThinkingKey],
        onClick: ({ key }) => {
          if (key === 'off') {
            onEnabledChange(false);
          } else {
            onValueChange(key);
            onEnabledChange(true);
          }
          onMenuOpenChange(false);
        },
      }}
      onOpenChange={onMenuOpenChange}
    >
      {thinkingSwitch}
    </Dropdown>
  );
}

function formatThinkingEffort(effort: string, fallback = 'Thinking'): string {
  const value = effort.trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : fallback;
}
