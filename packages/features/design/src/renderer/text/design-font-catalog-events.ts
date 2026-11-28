export const designFontCatalogChannel = 'setsuna-design-fonts';

export function notifyDesignFontCatalogChanged() {
  if (typeof BroadcastChannel !== 'function') return;
  const channel = new BroadcastChannel(designFontCatalogChannel);
  channel.postMessage(null);
  channel.close();
}
