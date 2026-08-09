export type PluginDraftFileInput = {
  path: string;
  content: string;
};

export type PluginDraftInput = {
  pluginId: string;
  manifest: Record<string, unknown>;
  files: PluginDraftFileInput[];
};

export type PluginDraft = {
  pluginId: string;
  path: string;
};

/** Stores complete AI-authored Plugin Bundle snapshots outside the installed-plugin directory. */
export type PluginDraftStore = {
  pathFor(pluginId: string): string;
  writeDraft(input: PluginDraftInput): Promise<PluginDraft>;
};
