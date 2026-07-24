import type { RuntimeConfigInput } from '@setsuna-desktop/contracts';

export type SettingsSectionId =
  | 'general'
  | 'personalization'
  | 'localLlm'
  | 'taskModels'
  | 'usage'
  | 'archives'
  | 'runtime'
  | 'about';

export type RuntimePreferenceInput = Pick<
  RuntimeConfigInput,
  | 'globalPrompt'
  | 'memory'
  | 'memoryEnabled'
  | 'taskModels'
  | 'setsunaStyle'
  | 'approvalPolicy'
  | 'permissionProfile'
  | 'sandboxWorkspaceWrite'
  | 'bypassHookTrust'
  | 'features'
  | 'desktopSettings'
>;
