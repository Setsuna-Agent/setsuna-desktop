# React 自定义应用

自定义侧栏应用继续是 Plugin Bundle，通过 `renderer.plugin.page` contribution 的 `reactApp` 指向独立前端项目。通用底座负责 React 挂载、Vite 编译、HashRouter、默认依赖、组件和主题样式；业务页面、组件、hook、CSS 和 package.json 由应用自己维护。作者示例及 SDK API 见[应用构建器指南](../../../plugins/app-builder/skills/create-plugin-in-chat/references/react-app.md)。

## 清单

```json
{
  "id": "notes.page",
  "slot": "renderer.plugin.page",
  "navigation": { "label": "笔记" },
  "data": { "stateKey": "notes.view", "scope": "global" },
  "reactApp": {
    "root": "app",
    "entry": "pages/Home.tsx",
    "routes": [{ "path": "/notes/:id", "entry": "pages/Detail.tsx" }],
    "actionIds": ["notes.save"]
  }
}
```

`root` 相对 Bundle，所有入口相对项目根。路由页面默认导出 React component；主入口处理未匹配路径。每个项目使用自己的 dependency graph 和 node_modules，不能跨项目 import。 项目根目录 `styles.css` 是约定的全局样式入口，受管 main 自动导入；其他 CSS 按页面/组件显式导入。HashRouter 保留当前文档及 MessagePort，导航不会重新取得宿主授权。

`@setsuna/app` 复用 `@setsuna-desktop/renderer-ui` 的全部公共 UI：按钮、字段、浮层下拉、复选框、开关、菜单、Tooltip、Dialog、Tabs、表格、图片预览、Toast、文件树和 Markdown 等。字段标签、Checkbox 原生事件和 Table 的 rows/render API 由 SDK 窄适配；控件结构、交互与样式仍由共享 UI 包持有。Markdown 与宿主文档阅读使用同一个经过 HTML/URL 过滤的 GFM 实现；聊天的文件导航、流式消息等业务仍由所属 Feature 持有。

SDK 构建时携带共享 UI 的编译产物、类型和 CSS，生成只引用 SDK 内部本地包的安装清单。Tabs 等组件使用的 Tailwind utilities 在 SDK 打包时编译，并连同基础 reset 和宿主主题映射进入默认样式；独立应用不需要安装 Tailwind，也不在启动或插件安装时扫描公共组件。独立项目不解析仓库 workspace 链接，构建按引用裁剪未使用的 UI 模块。主题快照传递共享控件的 `--app-*` 语义变量，兼容既有 `--setsuna-*`；iframe 使用自己的 viewport 和 scale，避免宿主已缩放后浮层再次缩放。

状态订阅、action 和 runtime request helper 直接包装现有 `setsunaUI`，没有额外存储、权限或全局服务注册。应用可安装其他浏览器兼容的 registry packages；worker extension 仍使用独立、自包含的 Node 源码。

## 安装、更新和打开

```mermaid
flowchart LR
  A[完整源码快照与审批] --> B[staged Plugin]
  B --> C[项目副本与默认 SDK]
  C --> D[pnpm 安装]
  D --> T[独立进程检查 TypeScript]
  T --> E[独立进程运行 Vite]
  E --> F[绑定产物哈希并提交索引]
  F --> G[打开时校验与读取缓存]
  G --> H[现有隔离页面及数据桥]
```

1. Manifest/preflight 检查项目、路由入口、package declarations 和保留路径。审批仍绑定整份 Bundle 快照；不通过 renderer 访问 runtime 私有路径。
2. 获批安装、更新或信任时，从同一可信快照复制项目到 `runtime/plugin-app-projects/<plugin-id>/<cache-key>/project`，注入 SDK、入口和受管 package.json。
3. 通过已有 Workspace Dependencies capability 按需准备 package toolchain 和代理/registry/cache 环境。使用 pnpm 7.33.7，不运行 lifecycle scripts 或 pnpm hooks。
4. 单个构建队列限制并发；依赖安装后先在子进程运行 TypeScript 检查，再启动 Vite 子进程。SDK 参数或跨文件类型错误阻止 staged 安装/更新提交。任务受调用取消、Feature 关闭和 180 秒超时约束；关闭后迟到的工具链结果不能启动 installer 或发布产物。
5. 编译 JS/CSS 形成现有 document source DTO。私有索引绑定缓存 key 和 source hash，公共 Plugin 摘要不携带构建记录。提交前校验完整 staged Bundle，失败沿用原安装事务回滚。
6. 打开只校验可信 Bundle 和产物哈希，然后通过已有 `readRendererUiDocument` operation 返回源码。缺失或被修改的缓存拒绝读取，不隐式重装包或编译。成功更新清理索引不再引用的旧项目；失败保留原版本缓存，卸载清理该 Plugin 的全部项目缓存。

普通启动仅构造无 I/O 的 service 并绑定 capability。没有 Vite 常驻服务、应用扫描、依赖安装、SDK 读取或缓存恢复等待；每个应用的数量及包安装耗时不进入 runtime ready、desktop.whenReady 或首帧关键路径。

快照通过 MessagePort 传入隔离页面。重复读取或主题通知的数据/上下文未变化时，bridge 保留对象身份，避免 React 的数据依赖 effect 重置表单草稿；主题通知仍发送给订阅者。真实数据变化正常生成新快照，业务页面仍应自行管理未保存草稿。

React `invokeAction(id, payload)` 的参数进入 worker 的 `input.payload`；`input.values` 仅用于 tree 的字符串字段。生成指南要求写入前拒绝非法参数；`verify_plugin.expectStateValues` 可对保存后的字段或数组项断言准确值，防止错误保存空数组却因字段存在而通过验证。

## 边界

- 页面仍运行在 `setsuna-plugin-ui` 独立 origin，无 Node、preload、宿主 DOM、端口或 token。沿用现有 action allowlist、scope 校验、完整 Bundle 信任、runtime bridge 和页面权限审批。
- 只使用受管 Vite 配置；不读取应用 env、Vite/PostCSS 配置，不执行 Node CSS preprocessors。支持普通 CSS/CSS modules、相对/动态 import 和内联资产；独立输出资源及 public 目录不自动发布。JS、CSS import 和 CSS url 的本地文件解析都限制在项目内。
- 应用的依赖声明支持 registry 版本、范围、tag；不支持 file/git/workspace 依赖或本地目录 lockfile。SDK 及其内置共享 UI 是宿主提供的本地依赖，应用不能声明其他本地路径。安装不执行脚本，新增包仍需符合浏览器运行环境。
- 源码沿用 Bundle 的 1,000 文件/32 MiB 边界；对话 configure_plugin 沿用 64 文件/512 KiB。编译文档最多 8 MiB。
- 本版不提供开发服务器、HMR、自定义构建插件或前端包共享给 extension worker。应用更新通过已有 configure_plugin 完整快照完成。

## 源码与验证

- `packages/contracts/src/plugin-ui/react-app.ts`：项目与路由契约。
- `packages/app-sdk/src/`：共享 UI 导出、窄组件适配、hook 与窄桥接 helper。
- `packages/renderer-ui/src/`：宿主与应用共用的控件、Markdown 和样式。
- `scripts/prepare-app-sdk-assets.mjs`：共享 UI 产物和独立安装清单打包。
- `packages/desktop-runtime/src/adapters/plugin-app/`：源码、依赖、独立编译和缓存生命周期。
- `packages/desktop-runtime/src/adapters/plugin/plugin-ui-document-reader.ts`：可信源码与缓存读取。
- `scripts/build-electron.ts`：发布独立 compiler worker；Vite 及原生编译器依赖随包提供。
- `packages/desktop-runtime/test/integration/plugin-react-app.test.ts`：真实 pnpm/TypeScript/Vite、发布 ASAR compiler、Electron 隔离页、重复快照后的草稿保留、项目依赖隔离、多文件/package/路由、worker 数据持久化、权限、缓存完整性和更新失败回滚。打包与缓存替换使用最小应用，类型错误与失败回滚共用一次更新，避免重复编译完整 SDK 控件。
- `packages/renderer-ui/test/`：在控件所属层验证弹窗/下拉交互与焦点恢复、Markdown 内容过滤和链接回调，不在应用安装集成测试中重复构建控件展示页。
- `packages/desktop-runtime/test/integration/plugin-react-app-startup.test.ts`：安装应用但工具链挂起/失败时的核心健康检查和耗时比较。
- `packages/desktop-runtime/test/adapters/plugin-app/project-service.test.ts`：构建队列取消、关闭时清理和环境变量边界。
