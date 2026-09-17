const MEMORY_REQUEST_PREFIXES = [
  { pattern: /^(?:请|帮我|麻烦你)?(?:记住|记一下|记下来)(?:这件事|一下|一点)?/u, separators: /^[：:，,\s]+/u },
  { pattern: /^(?:请|帮我|麻烦你)?(?:保存|存储|写入|加入)(?:为|成|到|进)?(?:长期)?记忆/u, separators: /^[：:，,\s]+/u },
  { pattern: /^(?:please\s+)?remember(?:\s+that)?/i, separators: /^[\s:,-]+/u },
  { pattern: /^(?:please\s+)?(?:save|store)(?:\s+this)?(?:\s+(?:as|to|in))?\s+memory/i, separators: /^[\s:,-]+/u },
];

export function explicitMemoryContentFromUserText(value: string): string {
  const text = value.trim();
  if (!text) return '';
  for (const { pattern, separators } of MEMORY_REQUEST_PREFIXES) {
    const prefix = pattern.exec(text);
    if (!prefix) continue;
    // Parse the prefix and trim separators separately so a failed content match
    // cannot backtrack across an arbitrarily long run of whitespace.
    const content = cleanExplicitMemoryContent(text.slice(prefix[0].length).replace(separators, ''));
    if (content) return content;
  }
  return '';
}

function cleanExplicitMemoryContent(value: string): string {
  const text = value.trim();
  let start = 0;
  let end = text.length;
  while (start < end && '"\'“”‘’'.includes(text[start]!)) start += 1;
  // Scan from the end rather than retrying a trailing regex at every punctuation mark.
  while (end > start && '"\'“”‘’。.!?？'.includes(text[end - 1]!)) end -= 1;
  const content = text.slice(start, end).trim();
  if (content.length < 3) return '';
  if (/^(吗|么|嘛|没有|了吗|一下)?[？?]*$/u.test(content)) return '';
  return content;
}
