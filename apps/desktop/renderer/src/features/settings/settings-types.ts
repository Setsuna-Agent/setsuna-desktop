import type { RuntimeConfigInput } from '@setsuna-desktop/contracts';

export type CoreSettingsSectionId =
  | 'general'
  | 'shortcuts'
  | 'personalization'
  | 'taskModels'
  | 'archives'
  | 'storage'
  | 'runtime'
  | 'about';

export type SettingsSectionId = CoreSettingsSectionId | (string & {});

export type SettingsPageLocation = Readonly<{
  sectionId: SettingsSectionId;
  /** Feature-owned page identities; an empty path opens the section overview. */
  path: readonly string[];
}>;

export type RuntimePreferenceInput = Pick<
  RuntimeConfigInput,
  | 'globalPrompt'
  | 'taskModels'
  | 'setsunaStyle'
  | 'imageCompression'
  | 'approvalPolicy'
  | 'approvalReviewer'
  | 'permissionProfile'
  | 'sandboxWorkspaceWrite'
  | 'bypassHookTrust'
  | 'features'
  | 'desktopSettings'
>;
