import type { RuntimeConfigInput } from '@setsuna-desktop/contracts';

export type SettingsSectionId =
  | 'general'
  | 'personalization'
  | 'localLlm'
  | 'usage'
  | 'archives'
  | 'runtime'
  | 'about';

export type RuntimePreferenceInput = Pick<
  RuntimeConfigInput,
  | 'globalPrompt'
  | 'storagePath'
  | 'memory'
  | 'memoryEnabled'
  | 'setsunaStyle'
  | 'approvalPolicy'
  | 'permissionProfile'
  | 'sandboxWorkspaceWrite'
  | 'bypassHookTrust'
  | 'features'
  | 'desktopSettings'
>;
