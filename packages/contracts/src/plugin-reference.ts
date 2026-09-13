export type RuntimePluginReference = {
  id: string;
  name: string;
  icon?: string;
};

export type RuntimePluginMention = { pluginId: string; label: string; start: number; end: number };

/** A textual reference survives draft restore, queued turns, retries and thread copies. */
export function pluginMentionText(plugin: Pick<RuntimePluginReference, 'id' | 'name'>): string {
  const label = plugin.name.replace(/[[\]\r\n]/gu, ' ').trim() || plugin.id;
  const id = encodeURIComponent(plugin.id).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16)}`);
  return `[$${label}](plugin://${id})`;
}

export function parsePluginMentions(content: string): RuntimePluginMention[] {
  const mentions: RuntimePluginMention[] = [];
  // Code examples are not selections. Consume fenced and inline code before reference tokens.
  const tokens = /(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\2[ \t]*(?=\r?$)|$(?![\s\S])))|(`+)[^\n]*?\3|\[\$([^\]\r\n]+)\]\(plugin:\/\/([^\s)]+)\)/gmu;
  for (const match of content.matchAll(tokens)) {
    if (!match[4] || !match[5]) continue;
    try {
      const pluginId = decodeURIComponent(match[5]);
      if (!pluginId || /[\s\p{Cc}]/u.test(pluginId)) continue;
      mentions.push({ pluginId, label: match[4], start: match.index, end: match.index + match[0].length });
    } catch { /* Malformed links remain ordinary text. */ }
  }
  return mentions;
}
