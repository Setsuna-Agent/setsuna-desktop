import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Progress } from 'antd';
import {
  CheckSquare,
  CircleGauge,
  MessageSquare,
  ShieldCheck,
  Target,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SkillIcon } from '../../../shared/ui/SkillIcon.js';
import { createSlashCommandMenuSections } from './chatSlashCommandSections.js';
import { useActiveOptionScroll } from './useActiveOptionScroll.js';

export type SlashCommandMenuItem =
  | {
      description?: string;
      disabled?: boolean;
      key: string;
      kind: 'action';
      loading?: boolean;
      progressPercent?: number;
      title: string;
      type: 'clear-context' | 'collaboration' | 'compact-context' | 'goal' | 'review' | 'side-chat' | 'usage';
    }
  | {
      description?: string;
      key: string;
      kind: 'model';
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
  const sections = createSlashCommandMenuSections(items);

  return (
    <div ref={scrollContainerRef} className="chat-command-menu chat-skill-command-menu" role="listbox" aria-label={t('chat.command.label')}>
      {items.length ? (
        sections.map((section) => {
          const sectionLabel = section.id === 'skills' ? t('chat.command.skill') : t('chat.command.label');
          return (
            <div
              key={`${section.id}:${section.items[0]?.item.key ?? 'empty'}`}
              className="chat-command-menu__section"
              role="group"
              aria-label={sectionLabel}
            >
              <div className="chat-command-menu__title">{sectionLabel}</div>
              {section.items.map(({ index, item }) => (
                <button
                  ref={index === activeIndex ? activeOptionRef : undefined}
                  key={item.key}
                  type="button"
                  className={`chat-command-menu__item ${item.kind === 'skill' ? 'chat-command-menu__item--skill' : ''} ${index === activeIndex ? 'is-active' : ''}`}
                  disabled={item.kind === 'action' && item.disabled}
                  role="option"
                  aria-selected={index === activeIndex}
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
                  {item.kind === 'skill' ? (
                    <span className="chat-command-menu__item-scope">
                      {unresolvedSkillMcpDependencyCount(item.skill)
                        ? t('chat.command.needsConfiguration')
                        : item.skill.kind === 'user'
                          ? t('chat.command.personal')
                          : item.skill.kind === 'plugin'
                            ? t('chat.command.plugin')
                            : t('chat.command.builtIn')}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          );
        })
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
  if (item.kind === 'skill') {
    return <SkillIcon skill={item.skill} variant="menu" />;
  }
  if (item.kind === 'model') return <Zap className="chat-command-menu__item-icon" fill="currentColor" size={15} strokeWidth={0} />;
  if (item.type === 'collaboration') return <Users className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'goal') return <Target className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'usage') return <CircleGauge className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'review') return <ShieldCheck className="chat-command-menu__item-icon" size={15} />;
  if (item.type === 'side-chat') return <MessageSquare className="chat-command-menu__item-icon" size={15} />;
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
