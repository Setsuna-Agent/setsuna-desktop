export type ReviewMarkdownLink = {
  labelEnd: number;
  targetEnd: number;
  targetStart: number;
};

/** Finds complete inline Markdown links in one pass over untrusted review output. */
export function reviewMarkdownLinksByLabelStart(line: string): Map<number, ReviewMarkdownLink> {
  const links = new Map<number, ReviewMarkdownLink>();
  let labelStart = -1;
  let activeLink: (ReviewMarkdownLink & { labelStart: number }) | null = null;
  let targetDepth = 0;

  for (let cursor = 0; cursor < line.length; cursor += 1) {
    if (line[cursor] === '\\') {
      cursor += 1;
      continue;
    }
    if (activeLink) {
      if (line[cursor] === '(') targetDepth += 1;
      if (line[cursor] !== ')' || --targetDepth > 0) continue;
      links.set(activeLink.labelStart, { ...activeLink, targetEnd: cursor });
      activeLink = null;
      continue;
    }
    if (line[cursor] === '[') {
      labelStart = cursor;
    } else if (labelStart >= 0 && line[cursor] === ']' && line[cursor + 1] === '(') {
      activeLink = {
        labelEnd: cursor,
        labelStart,
        targetEnd: -1,
        targetStart: cursor + 2,
      };
      targetDepth = 1;
      labelStart = -1;
      cursor += 1;
    }
  }
  return links;
}
