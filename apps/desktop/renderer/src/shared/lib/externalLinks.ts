export function openExternalLink(href: string): void {
  if (typeof window === 'undefined') return;
  const openExternal = window.setsunaDesktop?.links?.openExternal;
  if (openExternal) {
    void openExternal(href).catch((error: unknown) => {
      console.error('[links] failed to open external link', error);
    });
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}
