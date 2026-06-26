export type RuntimeSkillKind = 'builtin' | 'user';

export type RuntimeSkillSummary = {
  id: string;
  name: string;
  kind: RuntimeSkillKind;
  enabled: boolean;
  selected: boolean;
  description?: string;
  path?: string;
};

export type RuntimeSkillDetail = RuntimeSkillSummary & {
  content: string;
  references: string[];
};

export type RuntimeSkillList = {
  skills: RuntimeSkillSummary[];
};

export type RuntimeSkillInput = {
  id?: string;
  name: string;
  description?: string;
  content: string;
  enabled?: boolean;
  selected?: boolean;
};

export type RuntimeSkillPatch = {
  enabled?: boolean;
  selected?: boolean;
  name?: string;
  description?: string;
  content?: string;
};
