export const networkProxyZhCN = {
  'settings.providers.proxy': '代理服务器',
  'settings.providers.proxyDescription': '仅覆盖这个模型厂商；“跟随 Runtime”使用代理页中的 Agent Runtime 路由。',
  'settings.providers.proxyInherit': '跟随 Runtime',
  'settings.providers.proxySystem': '系统默认',
  'settings.providers.proxyDirect': '直连',
} as const;

export const networkProxyEnUS: Record<keyof typeof networkProxyZhCN, string> = {
  'settings.providers.proxy': 'Proxy server',
  'settings.providers.proxyDescription': 'Overrides only this model provider. “Use Runtime route” follows Agent Runtime on the proxy page.',
  'settings.providers.proxyInherit': 'Use Runtime route',
  'settings.providers.proxySystem': 'System default',
  'settings.providers.proxyDirect': 'Direct connection',
};
