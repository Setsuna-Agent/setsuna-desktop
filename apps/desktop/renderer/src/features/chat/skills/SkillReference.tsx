import type { RuntimeSkillReference, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { createContext, Fragment, memo, useContext, type ReactNode } from 'react';
import { WorkspaceMentionText } from '../mentions/WorkspaceMentionText.js';
import { ChatCapabilityReferenceIcon } from '../references/ChatCapabilityReferenceIcon.js';
import { parseSkillReferenceText, skillDisplayText } from './skillReferenceParser.js';

const SkillReferenceCatalogContext = createContext<RuntimeSkillSummary[]>([]);

export function SkillReferenceCatalogProvider({
  children,
  skills,
}: {
  children: ReactNode;
  skills: RuntimeSkillSummary[];
}) {
  return (
    <SkillReferenceCatalogContext.Provider value={skills}>
      {children}
    </SkillReferenceCatalogContext.Provider>
  );
}

export const SkillReferenceLabel = memo(function SkillReferenceLabel({
  displayText,
  skill,
}: {
  displayText?: string;
  skill: RuntimeSkillSummary;
}) {
  return (
    <SkillReferencePresentation
      displayText={displayText ?? skillDisplayText(skill)}
      title={skill.description || skill.id}
    />
  );
});

export const SkillReferenceText = memo(function SkillReferenceText({
  content,
  skillReferences,
}: {
  content: string;
  skillReferences: RuntimeSkillReference[] | undefined;
}) {
  const skills = useContext(SkillReferenceCatalogContext);
  return (
    <>
      {parseSkillReferenceText(content, skillReferences, skills).map((part) => (
        part.type === 'text' ? (
          <Fragment key={`text:${part.start}`}>
            <WorkspaceMentionText content={part.value} />
          </Fragment>
        ) : (
          <SkillReferencePresentation
            key={`skill:${part.start}:${part.skillId}`}
            displayText={part.value}
            title={part.skill?.description || part.skillId}
          />
        )
      ))}
    </>
  );
});

function SkillReferencePresentation({
  displayText,
  title,
}: {
  displayText: string;
  title: string;
}) {
  return (
    <span className="chat-skill-reference" title={title}>
      <ChatCapabilityReferenceIcon />
      <span>{displayText}</span>
    </span>
  );
}
