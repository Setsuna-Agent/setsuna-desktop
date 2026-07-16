import { Progress } from 'antd';
import { Boxes, CheckSquare, CircleGauge, Database, ListChecks, MessageSquare, ShieldCheck, Target, Trash2, Users, Zap } from 'lucide-react';
import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
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
  const { activeOptionRef, scrollContainerRef } = useActiveOptionScroll<HTMLDivElement, HTMLButtonElement>(items[activeIndex]?.key);

  return (
    <div ref={scrollContainerRef} className="chat-command-menu chat-skill-command-menu" role="listbox" aria-label="命令">
      <div className="chat-command-menu__title">{menuTitle(items[activeIndex] ?? items[0])}</div>
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
                      ? `需要配置 ${unresolvedSkillMcpDependencyCount(item.skill)} 个 MCP 依赖${item.skill.description ? ` · ${item.skill.description}` : ''}`
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
                    ? '需配置'
                    : item.skill.kind === 'user' ? '个人' : item.skill.kind === 'plugin' ? '插件' : '内置'
                  : item.scope}
              </span>
            )}
          </button>
        ))
      ) : (
        <div className="chat-command-menu__state">没有匹配的命令或 Skill</div>
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

function menuTitle(item?: SlashCommandMenuItem): string {
  if (!item) return '命令';
  if (item.kind === 'skill') return '技能';
  if (item.kind === 'model') return '模型选择';
  if (item.type === 'plan') return '计划';
  if (item.type === 'collaboration') return '协作';
  if (item.type === 'goal') return '目标';
  if (item.type === 'usage') return '用量与诊断';
  if (item.type === 'review') return '审查';
  if (item.type === 'side-chat') return '侧边任务';
  if (item.type === 'memory-mode') return '记忆';
  return '命令';
}

function isSwitchAction(type: Extract<SlashCommandMenuItem, { kind: 'action' }>['type']): boolean {
  return type === 'memory-mode' || type === 'plan' || type === 'collaboration' || type === 'goal';
}
