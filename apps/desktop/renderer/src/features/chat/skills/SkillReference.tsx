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
    <span className="chat-skill-reference" title={skill.description || skill.id}>
      <ChatCapabilityReferenceIcon />
      <span>{displayText ?? skillDisplayText(skill)}</span>
    </span>
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
          <SkillReferenceLabel
            key={`skill:${part.start}:${part.skill.id}`}
            displayText={part.value}
            skill={part.skill}
          />
        )
      ))}
    </>
  );
});
