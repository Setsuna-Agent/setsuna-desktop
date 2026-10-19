import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { Fragment, type ReactNode } from 'react';
import type { WorkHistoryExpandedChangeHandler } from './chat-workspace-types.js';
import { inferWorkTiming, WorkHistoryDetails, WorkHistoryPanel } from './ChatWorkHistory.js';

export type WorkHistoryTimelineSection =
  | { type: 'content'; id: string; children: ReactNode }
  | {
      type: 'work';
      id: string;
      children: ReactNode;
      persistentChildren?: ReactNode;
      hasDetails: boolean;
      hasFollowingContent: boolean;
      segments: RuntimeMessage[];
    };

/** One disclosure owns the turn's work, including sections separated by visible results. */
export function ChatWorkHistoryTimeline({
  active,
  defaultExpanded,
  itemId,
  onExpandedChange,
  sections,
}: {
  active: boolean;
  defaultExpanded: boolean;
  itemId: string;
  onExpandedChange: WorkHistoryExpandedChangeHandler;
  sections: WorkHistoryTimelineSection[];
}) {
  const firstWorkIndex = sections.findIndex((section) => section.type === 'work');
  const workSections = sections.filter((section) => section.type === 'work');
  const firstWork = workSections[0];
  if (!firstWork) return <>{sections.map(renderSection)}</>;

  const followingSections = sections.slice(firstWorkIndex);
  const hasFollowingContent = workSections.some((section) => section.hasFollowingContent);
  const timing = inferWorkTiming(workSections.flatMap((section) => section.segments));
  const panelId = `${itemId}:work-history:${firstWork.id}`;
  return (
    <>
      {sections.slice(0, firstWorkIndex).map(renderSection)}
      <WorkHistoryPanel
        active={active}
        collapseWhenContentFollows={hasFollowingContent}
        completedAtMs={timing.completedAtMs}
        defaultExpanded={defaultExpanded && !hasFollowingContent}
        hasDetails={workSections.some((section) => section.hasDetails)}
        key={panelId}
        onExpandedChange={onExpandedChange}
        panelId={panelId}
        startedAtMs={timing.startedAtMs}
      >
        {followingSections.map(renderSection)}
      </WorkHistoryPanel>
    </>
  );
}

function renderSection(section: WorkHistoryTimelineSection) {
  // Content stays mounted at its keyed position; only work details animate with the panel.
  if (section.type === 'content') return <Fragment key={section.id}>{section.children}</Fragment>;
  return (
    <WorkHistoryDetails key={section.id} persistentChildren={section.persistentChildren}>
      {section.children}
    </WorkHistoryDetails>
  );
}
