import { parse, type DefaultTreeAdapterTypes } from 'parse5';

export function websiteFaviconCandidates(html: string, pageUrl: string): string[] {
  const document = parse(html);
  const root = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'html');
  const head = root?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'head');
  const elements = head?.childNodes.filter((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node) ?? [];
  const attribute = (element: DefaultTreeAdapterTypes.Element, name: string) => element.attrs.find((attr) => attr.name === name)?.value;
  const baseHref = elements.find((element) => element.tagName === 'base' && attribute(element, 'href') !== undefined);
  let baseUrl = pageUrl;
  try {
    if (baseHref) baseUrl = new URL(attribute(baseHref, 'href')!, pageUrl).href;
  } catch { /* Ignore malformed base URLs. */ }

  const candidates: string[] = [];
  for (const element of elements) {
    if (element.tagName !== 'link') continue;
    const rel = attribute(element, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    if (!rel.some((value) => value === 'icon' || value === 'apple-touch-icon' || value === 'apple-touch-icon-precomposed')) continue;
    const href = attribute(element, 'href');
    if (!href) continue;
    try {
      const url = new URL(href, baseUrl);
      if (!['https:', 'http:', 'data:'].includes(url.protocol) || url.username || url.password) continue;
      if (!candidates.includes(url.href)) candidates.push(url.href);
    } catch { /* A bad link must not hide the site's remaining icons. */ }
    if (candidates.length >= 8) break;
  }
  return candidates;
}
