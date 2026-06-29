export type MainView = 'chat' | 'capabilities' | 'settings';

export type ChatSkillSelectionRequest = {
  skillId: string;
  requestId: number;
};
