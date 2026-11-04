import { Button as UiButton, ProgressRing } from '@setsuna-desktop/renderer-ui';
import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';

import {
  LoaderCircle,
  Plus,
  X,
} from 'lucide-react';
import type {
  ReactNode,
} from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { RuntimeAccessModeSelection } from '../../../shared/lib/runtimeAccessMode.js';
import { ShortcutTooltip } from '../../../shared/ui/ShortcutTooltip.js';
import { AppTooltip } from '../../../shared/ui/primitives.js';
import { formatTokenCount, type ChatContextTokenUsage } from '../conversation/chatContextUsage.js';
import { ChatApprovalPolicyMenu } from './ChatApprovalPolicyMenu.js';
import { ChatModelPicker } from './ChatModelPicker.js';
import { ChatSubmitIcon } from './editor/ChatSubmitIcon.js';
import type { ChatThinkingControl } from './chatThinkingMenu.js';

type ChatComposerFooterCommandControl = {
  active: boolean;
  disabled: boolean;
  onOpen: () => void;
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

export function ChatComposerFooter({
  commandControl,
  config,
  contextCompacting,
  contextUsage,
  hasActiveTurn,
  modeBadges,
  model,
  modelOpenSignal,
  modelFallbackCode,
  modelProvider,
  primaryAction,
  senderActions,
  thinkingControl,
  onAccessModeChange,
  onSelectModel,
}: {
  commandControl: ChatComposerFooterCommandControl;
  config: RuntimeConfigState | null;
  contextCompacting: boolean;
  contextUsage: ChatContextTokenUsage;
  hasActiveTurn: boolean;
  modeBadges: ChatComposerFooterModeBadges;
  model: ProviderModelConfig | null;
  modelOpenSignal: number;
  modelFallbackCode?: string;
  modelProvider: ProviderConfigState | null;
  primaryAction: ChatComposerFooterPrimaryAction;
  senderActions: ReactNode;
  thinkingControl: ChatThinkingControl;
  onAccessModeChange: (selection: RuntimeAccessModeSelection) => void;
  onSelectModel: (providerId: string, modelId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="chat-sender__footer">
      <div className="chat-sender__left-actions">
        <UiButton variant="ghost"
          className={`chat-sender-icon-button chat-sender-command-button ${commandControl.active ? 'is-active' : ''}`}
          type="button"
          disabled={commandControl.disabled}
          aria-label={t('chat.composer.openCommands')}
          title={t('chat.composer.openCommands')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={commandControl.onOpen}
        >
          <Plus size={14} />
        </UiButton>
        <ChatApprovalPolicyMenu
          approvalPolicy={config?.approvalPolicy ?? 'on-request'}
          approvalReviewer={config?.approvalReviewer}
          permissionProfile={config?.permissionProfile ?? 'workspace-write'}
          onChange={onAccessModeChange}
        />
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
        <ChatContextUsageIndicator compacting={contextCompacting} usage={contextUsage} />
        <ChatModelPicker
          config={config}
          fallbackModelCode={modelFallbackCode}
          model={model}
          openSignal={modelOpenSignal}
          provider={modelProvider}
          thinkingControl={thinkingControl}
          onSelect={onSelectModel}
        />
        <div className="chat-sender__primary-action">
          <ChatComposerPrimaryAction
            hasActiveTurn={hasActiveTurn}
            primaryAction={primaryAction}
            senderActions={senderActions}
          />
        </div>
      </div>
    </div>
  );
}

function ChatContextUsageIndicator({ compacting, usage }: {
  compacting: boolean;
  usage: ChatContextTokenUsage;
}) {
  const { t } = useI18n();
  const usedTokens = Math.round(Number(usage.usedTokens || 0));
  if (usedTokens <= 0) return null;

  const totalTokens = Math.round(Number(usage.totalTokens || 0));
  const rawPercent = Number(usage.visiblePercent || usage.percent || 0);
  const percentValue = Math.min(100, Math.max(0, rawPercent > 0 && rawPercent < 0.1 ? 0.1 : rawPercent));
  const percentLabel = `${percentValue.toFixed(percentValue > 0 && percentValue < 1 ? 1 : 0)}%`;
  const tokenLabel = totalTokens > 0
    ? `${formatTokenCount(usedTokens)}/${formatTokenCount(totalTokens)}`
    : `${formatTokenCount(usedTokens)} tokens`;
  const usageLabel = percentValue > 0 ? `${percentLabel} · ${tokenLabel}` : tokenLabel;

  return (
    <AppTooltip title={usageLabel} placement="top">
      <span className="chat-context-usage" tabIndex={0}>
        {compacting ? (
          <LoaderCircle size={14} className="is-spinning" role="img" aria-label={t('chat.composer.compacting')} />
        ) : (
          <ProgressRing
            aria-label={t('chat.model.contextUsage', { usage: usageLabel })}
            className="chat-token-progress"
            percent={percentValue}
            size={14}
            strokeWidth={18}
          />
        )}
      </span>
    </AppTooltip>
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
  const stopping = hasActiveTurn && !primaryAction.queueReady;
  let button = senderActions;

  if (primaryAction.queueReady) {
    button = (
      <UiButton variant="primary"
        className="chat-prompt__submit"
        type="button"
        aria-label={t('chat.composer.queue')}
        title={t('chat.composer.queue')}
        disabled={primaryAction.attachmentsBusy || primaryAction.submitting}
        onClick={primaryAction.onSubmit}
      >
        <ChatSubmitIcon stop={false} />
      </UiButton>
    );
  } else if (stopping) {
    button = (
      <UiButton variant="primary"
        className="chat-prompt__submit"
        type="button"
        aria-label={t('chat.composer.stop')}
        onClick={primaryAction.onCancelActiveTurn}
      >
        <ChatSubmitIcon stop />
      </UiButton>
    );
  } else if (primaryAction.attachmentOnlyReady) {
    button = (
      <UiButton variant="primary"
        className="chat-prompt__submit"
        type="button"
        aria-label={t('chat.composer.send')}
        disabled={primaryAction.attachmentsBusy || primaryAction.submitting}
        onClick={primaryAction.onSubmit}
      >
        <ChatSubmitIcon stop={false} />
      </UiButton>
    );
  }

  // 各状态的按钮都放在同一个 Tooltip 包裹位置，React 会复用同一个按钮节点，
  // 发送 / 停止图标切换才有过渡；只有停止态展示快捷键提示。
  return (
    <ShortcutTooltip commandId="chat.cancelTurn" disabled={!stopping} label={t('chat.composer.stop')}>
      {button}
    </ShortcutTooltip>
  );
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
    <UiButton variant="ghost" className="chat-sender-plan-badge" type="button" disabled={disabled} aria-label={t('chat.composer.closeBadge', { label })} title={t('chat.composer.closeBadge', { label })} onClick={onClose}>
      <span className="chat-sender-plan-badge__label">{label}</span>
      <X className="chat-sender-plan-badge__close" size={11} aria-hidden="true" />
    </UiButton>
  );
}
