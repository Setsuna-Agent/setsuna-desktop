/** Plugin IDs are path-safe, while Renderer IDs use a narrower alphabet. */
export function rendererPluginIdentity(pluginId: string): string {
  return `p-${[...pluginId].map((character) => character.codePointAt(0)?.toString(16)).join('-')}`;
}

export function rendererPluginSidebarEntryId(pluginId: string, contributionId: string): string {
  return `third-party.${rendererPluginIdentity(pluginId)}.${contributionId}.navigation`;
}
