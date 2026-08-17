// 设置页与能力页是 lazy 路由：首次导航才请求 chunk 时，开发环境下 Vite 现编译，
// 用户会先看到 Suspense 兜底屏。这里的动态 import 与 lazy() 共用同一模块请求，
// 无额外副作用；预热完成后后续导航即可直接渲染。
export function prefetchSecondaryRoutes(): void {
  void import('../../features/settings/SettingsRoute.js').catch(() => undefined);
  void import('../../features/capabilities/CapabilitiesRoute.js').catch(() => undefined);
}
