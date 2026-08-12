import type { RuntimeSkillReference, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { createContext, Fragment, memo, useContext, type ReactNode } from 'react';
import { SkillIcon } from '../../../shared/ui/SkillIcon.js';
import { WorkspaceMentionText } from '../mentions/WorkspaceMentionText.js';
import { ChatInlineReference } from '../references/ChatInlineReference.js';
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
      skill={skill}
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
            skill={part.skill}
            title={part.skill?.description || part.skillId}
          />
        )
      ))}
    </>
  );
});

function SkillReferencePresentation({
  displayText,
  skill,
  title,
}: {
  displayText: string;
  skill?: RuntimeSkillSummary;
  title: string;
}) {
  return (
    <ChatInlineReference
      className="chat-skill-reference"
      icon={<SkillIcon skill={skill} />}
      label={displayText}
      title={title}
    />
  );
}
