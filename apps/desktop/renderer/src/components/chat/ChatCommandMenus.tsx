import { Boxes, File, Folder, LoaderCircle, X } from 'lucide-react';
import type { RuntimeSkillSummary, WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { skillDisplayText } from './chatCommandUtils.js';
import { useActiveOptionScroll } from './useActiveOptionScroll.js';

export function ProjectEntryCommandMenu({
  activeIndex,
  entries,
  hasProject,
  loadError,
  loading,
  onHover,
  onSelect,
}: {
  activeIndex: number;
  entries: WorkspaceEntrySearchItem[];
  hasProject: boolean;
  loadError: string;
  loading: boolean;
  onHover: (index: number) => void;
  onSelect: (entry: WorkspaceEntrySearchItem) => void;
}) {
  const activeEntry = entries[activeIndex];
  const activeEntryKey = activeEntry ? `${activeEntry.kind}:${activeEntry.path}` : null;
  const { activeOptionRef, scrollContainerRef } = useActiveOptionScroll<HTMLDivElement, HTMLButtonElement>(activeEntryKey);

  return (
    <div ref={scrollContainerRef} className="chat-command-menu chat-project-entry-command-menu" role="listbox" aria-label="项目文件">
      <div className="chat-command-menu__title">项目文件</div>
      {!hasProject ? (
        <div className="chat-command-menu__state">请先选择项目目录</div>
      ) : loading && !entries.length ? (
        <div className="chat-command-menu__state">
          <LoaderCircle className="chat-command-menu__state-icon is-spinning" size={14} />
          <span>正在搜索项目文件</span>
        </div>
      ) : loadError && !entries.length ? (
        <div className="chat-command-menu__state">{loadError}</div>
      ) : entries.length ? (
        <>
          {entries.map((entry, index) => (
            <button
              ref={index === activeIndex ? activeOptionRef : undefined}
              key={`${entry.kind}-${entry.path}`}
              type="button"
              className={`chat-command-menu__item ${index === activeIndex ? 'is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(entry);
              }}
              onMouseMove={() => onHover(index)}
            >
              {entry.kind === 'directory' ? (
                <Folder className="chat-command-menu__item-icon" size={15} />
              ) : (
                <File className="chat-command-menu__item-icon" size={15} />
              )}
              <span className="chat-command-menu__item-main">
                <span className="chat-command-menu__item-title">{entry.kind === 'directory' ? `${entry.name}/` : entry.name}</span>
                {entry.parent ? <span className="chat-command-menu__item-desc">{entry.parent}</span> : null}
              </span>
              <span className="chat-command-menu__item-scope">{entry.kind === 'directory' ? '文件夹' : '文件'}</span>
            </button>
          ))}
          {loadError ? <div className="chat-command-menu__state">{loadError}</div> : null}
        </>
      ) : (
        <div className="chat-command-menu__state">没有匹配的文件或文件夹</div>
      )}
    </div>
  );
}

export function SelectedSkillChips({
  skills,
  onRemove,
}: {
  skills: RuntimeSkillSummary[];
  onRemove: (skill: RuntimeSkillSummary) => void;
}) {
  return (
    <div className="chat-selected-skills" aria-label="已选技能">
      {skills.map((skill) => (
        <span className="chat-selected-skill" key={skill.id} title={skill.description || skill.id}>
          <Boxes size={13} />
          <span>{skillDisplayText(skill)}</span>
          <button type="button" aria-label={`移除 ${skill.name}`} onClick={() => onRemove(skill)}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}
