import type { RuntimeConfigInput } from '@setsuna-desktop/contracts';

export type CoreSettingsSectionId =
  | 'general'
  | 'shortcuts'
  | 'personalization'
  | 'localLlm'
  | 'taskModels'
  | 'usage'
  | 'archives'
  | 'runtime'
  | 'about';

export type SettingsSectionId = CoreSettingsSectionId | (string & {});

export type RuntimePreferenceInput = Pick<
  RuntimeConfigInput,
  | 'globalPrompt'
  | 'taskModels'
  | 'setsunaStyle'
  | 'approvalPolicy'
  | 'approvalReviewer'
  | 'permissionProfile'
  | 'sandboxWorkspaceWrite'
  | 'bypassHookTrust'
  | 'features'
  | 'desktopSettings'
>;
