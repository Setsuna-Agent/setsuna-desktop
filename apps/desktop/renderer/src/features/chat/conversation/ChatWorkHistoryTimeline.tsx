import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { Fragment, type ReactNode } from 'react';
import type { WorkHistoryExpandedChangeHandler } from './chat-workspace-types.js';
import { inferWorkTiming, WorkHistoryPanel } from './ChatWorkHistory.js';

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
  if (!firstWork) return <>{sections.map((section) => renderSection(section, true))}</>;

  const followingSections = sections.slice(firstWorkIndex);
  const hasPersistentContent = followingSections.some((section) => section.type === 'content' || section.persistentChildren);
  const hasFollowingContent = workSections.some((section) => section.hasFollowingContent);
  const timing = inferWorkTiming(workSections.flatMap((section) => section.segments));
  const panelId = `${itemId}:work-history:${firstWork.id}`;
  return (
    <>
      {sections.slice(0, firstWorkIndex).map((section) => renderSection(section, true))}
      <WorkHistoryPanel
        active={active}
        collapseWhenContentFollows={hasFollowingContent}
        completedAtMs={timing.completedAtMs}
        defaultExpanded={defaultExpanded && !hasFollowingContent}
        hasDetails={workSections.some((section) => section.hasDetails)}
        key={panelId}
        onExpandedChange={onExpandedChange}
        panelId={panelId}
        persistentChildren={hasPersistentContent ? followingSections.map((section) => renderSection(section, false)) : undefined}
        startedAtMs={timing.startedAtMs}
      >
        {followingSections.map((section) => renderSection(section, true))}
      </WorkHistoryPanel>
    </>
  );
}

function renderSection(section: WorkHistoryTimelineSection, expanded: boolean) {
  // Keep result cards at the same keyed position when work is expanded or collapsed.
  return (
    <Fragment key={section.id}>
      {section.type === 'content' || expanded ? section.children : section.persistentChildren}
    </Fragment>
  );
}
