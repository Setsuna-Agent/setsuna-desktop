import type { RuntimeFeatureSettingsDocumentHandle } from '@setsuna-desktop/feature-core/settings';
import type { GitSettings, GitSettingsState, ReviewRuntimeHost, ReviewSettingsState } from '../contracts/index.js';
import { settingsFailure } from './settings.js';

export type GitSettingsHandle = RuntimeFeatureSettingsDocumentHandle<GitSettings, GitSettings, Partial<GitSettings>, undefined>;
export type GitModelSetting = 'commitMessageModel' | 'conflictResolutionModel';

/** The dialog and dedicated-model page edit one revisioned document, so neither can overwrite stale values. */
export class RuntimeGitSettings {
  constructor(private readonly document: GitSettingsHandle, private readonly host: Pick<ReviewRuntimeHost, 'listModelOptions'>) {}

  async read(): Promise<GitSettingsState> {
    try {
      const [current, availableModels] = await Promise.all([this.document.readPublic(), this.host.listModelOptions()]);
      return { settings: current.value, revision: current.revision, availableModels };
    } catch (error) { throw settingsFailure(error); }
  }

  async value(): Promise<GitSettings> {
    try { return (await this.document.read()).value; }
    catch (error) { throw settingsFailure(error); }
  }

  async update(expectedRevision: number, patch: Partial<GitSettings>): Promise<GitSettingsState> {
    try {
      await this.document.update({ expectedRevision, patch });
      return await this.read();
    } catch (error) { throw settingsFailure(error); }
  }

  async readModel(key: GitModelSetting): Promise<ReviewSettingsState> {
    return this.modelState(await this.read(), key);
  }

  async updateModel(key: GitModelSetting, expectedRevision: number, selection: GitSettings[GitModelSetting]): Promise<ReviewSettingsState> {
    return this.modelState(await this.update(expectedRevision, { [key]: selection }), key);
  }

  private modelState(state: GitSettingsState, key: GitModelSetting): ReviewSettingsState {
    return { selection: state.settings[key], revision: state.revision, availableModels: state.availableModels };
  }
}
