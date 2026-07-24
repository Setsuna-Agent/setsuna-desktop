import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Progress } from 'antd';
import {
  Boxes,
  CheckSquare,
  CircleGauge,
  Database,
  ListChecks,
  MessageSquare,
  ShieldCheck,
  Target,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { useActiveOptionScroll } from './useActiveOptionScroll.js';

export type SlashCommandMenuItem =
  | {
      description?: string;
      disabled?: boolean;
      key: string;
      kind: 'action';
      loading?: boolean;
      progressPercent?: number;
      scope?: string;
      title: string;
      type: 'clear-context' | 'collaboration' | 'compact-context' | 'goal' | 'memory-mode' | 'plan' | 'review' | 'side-chat' | 'usage';
      checked?: boolean;
    }
  | {
      description?: string;
      key: string;
      kind: 'model';
      scope?: string;
      title: string;
    }
  | {
      key: string;
      kind: 'skill';
      skill: RuntimeSkillSummary;
    };

export function ChatSlashCommandMenu({
  activeIndex,
  items,
  onHover,
  onSelect,
}: {
  activeIndex: number;
  items: SlashCommandMenuItem[];
  onHover: (index: number) => void;
  onSelect: (item: SlashCommandMenuItem) => void;
}) {
  const { t } = useI18n();
  const { activeOptionRef, scrollContainerRef } = useActiveOptionScroll<HTMLDivElement, HTMLButtonElement>(items[activeIndex]?.key);

  return (
    <div ref={scrollContainerRef} className="chat-command-menu chat-skill-command-menu" role="listbox" aria-label={t('chat.command.label')}>
      <div className="chat-command-menu__title">{menuTitle(items[activeIndex] ?? items[0], t)}</div>
      {items.length ? (
        items.map((item, index) => (
          <button
            ref={index === activeIndex ? activeOptionRef : undefined}
            key={item.key}
            type="button"
            className={`chat-command-menu__item ${index === activeIndex ? 'is-active' : ''}`}
            disabled={item.kind === 'action' && item.disabled}
            role="option"
            aria-selected={index === activeIndex}
            aria-pressed={item.kind === 'action' && isSwitchAction(item.type) ? Boolean(item.checked) : undefined}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(item);
            }}
            onMouseMove={() => onHover(index)}
          >
            <SlashCommandIcon item={item} />
            <span className="chat-command-menu__item-main">
              <span className="chat-command-menu__item-title">{item.kind === 'skill' ? item.skill.name : item.title}</span>
              {item.kind === 'skill' ? (
                (item.skill.description || unresolvedSkillMcpDependencyCount(item.skill)) ? (
                  <span className="chat-command-menu__item-desc">
                    {unresolvedSkillMcpDependencyCount(item.skill)
                      ? `${t('chat.command.mcpRequired', { count: unresolvedSkillMcpDependencyCount(item.skill) })}${item.skill.description ? ` · ${item.skill.description}` : ''}`
                      : item.skill.description}
                  </span>
                ) : null
              ) : item.description ? (
                <span className="chat-command-menu__item-desc">{item.description}</span>
              ) : null}
            </span>
            {item.kind === 'action' && isSwitchAction(item.type) ? (
              <MemoryCommandSwitch checked={Boolean(item.checked)} disabled={Boolean(item.disabled)} />
            ) : (
              <span className="chat-command-menu__item-scope">
                {item.kind === 'skill'
                  ? unresolvedSkillMcpDependencyCount(item.skill)
                    ? t('chat.command.needsConfiguration')
                    : item.skill.kind === 'user'
                      ? t('chat.command.personal')
                      : item.skill.kind === 'plugin'
                        ? t('chat.command.plugin')
                        : t('chat.command.builtIn')
                  : item.scope}
              </span>
            )}
          </button>
        ))
      ) : (
        <div className="chat-command-menu__state">{t('chat.command.noMatch')}</div>
      )}
    </div>
  );
}

function unresolvedSkillMcpDependencyCount(skill: Extract<SlashCommandMenuItem, { kind: 'skill' }>['skill']): number {
  return (skill.mcpDependencies ?? []).filter((dependency) => dependency.status !== 'ready').length
    + (skill.dependencyErrors?.length ? 1 : 0);
}

function SlashCommandIcon({ item }: { item: SlashCommandMenuItem }) {
  if (item.kind === 'skill') return <Boxes className="chat-command-menu__item-icon" size={15} />;
  if (item.kind === 'model') return <Zap className="chat-command-menu__item-icon" fill="currentColor" size={15} strokeWidth={0} />;
  if (item.type === 'plan') return <ListChecks className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'collaboration') return <Users className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'goal') return <Target className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'usage') return <CircleGauge className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'review') return <ShieldCheck className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'side-chat') return <MessageSquare className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'memory-mode') return <Database className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'compact-context') {
    return (
      <Progress
        className="chat-command-progress-icon"
        type="circle"
        percent={Math.min(100, Math.max(0, Math.round(Number(item.progressPercent || 0))))}
        size={15}
        strokeWidth={18}
        showInfo={false}
        status={item.loading ? 'active' : 'normal'}
      />
    );
  }
  if (item.type === 'clear-context') return <Trash2 className="chat-command-menu__item-icon" size={15} />;
  return <CheckSquare className="chat-command-menu__item-icon" size={15} />;
}

function MemoryCommandSwitch({ checked, disabled }: { checked: boolean; disabled: boolean }) {
  return (
    <span className={`chat-command-menu__item-switch ${checked ? 'is-on' : ''} ${disabled ? 'is-disabled' : ''}`} aria-hidden="true">
      <span />
    </span>
  );
}

function menuTitle(item: SlashCommandMenuItem | undefined, t: Translate): string {
  if (!item) return t('chat.command.label');
  if (item.kind === 'skill') return t('chat.command.skill');
  if (item.kind === 'model') return t('chat.command.model');
  if (item.type === 'plan') return t('chat.command.plan');
  if (item.type === 'collaboration') return t('chat.command.collaboration');
  if (item.type === 'goal') return t('chat.command.goal');
  if (item.type === 'usage') return t('chat.composer.usage');
  if (item.type === 'review') return t('chat.command.review');
  if (item.type === 'side-chat') return t('chat.composer.sideChat');
  if (item.type === 'memory-mode') return t('chat.command.memory');
  return t('chat.command.label');
}

function isSwitchAction(type: Extract<SlashCommandMenuItem, { kind: 'action' }>['type']): boolean {
  return type === 'memory-mode' || type === 'plan' || type === 'collaboration' || type === 'goal';
}
