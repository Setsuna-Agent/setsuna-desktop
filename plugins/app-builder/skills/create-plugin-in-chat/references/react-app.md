# React 应用项目

新建本地侧栏应用默认使用 `reactApp`。每个 contribution 指向自己的项目目录，宿主提供统一 React/Vite 底座、路由、默认依赖和 `@setsuna/app`。页面不进入宿主 React 树，仍在独立 origin 内运行。

## 文件与路由

在当前工作区准备源文件，然后通过 `configure_plugin` 提交完整快照。项目目录、组件、hook 和页面可以任意组织；所有 import 必须留在项目内。不要提交 `node_modules`、`.setsuna`、`.npmrc`、pnpm hook 或 workspace 配置。

```text
extension/entry.mjs
app/package.json
app/pages/Home.tsx
app/pages/Detail.tsx
app/components/Item.tsx
app/hooks/useItems.ts
app/styles.css
```

```json
{
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["ui", "state"],
    "rendererUi": {
      "schemaVersion": 2,
      "actions": [{ "id": "items.save" }],
      "contributions": [{
        "id": "items.page",
        "slot": "renderer.plugin.page",
        "navigation": { "label": "事项" },
        "data": { "stateKey": "items.view", "scope": "global" },
        "reactApp": {
          "root": "app",
          "entry": "pages/Home.tsx",
          "routes": [{ "path": "/items/:id", "entry": "pages/Detail.tsx" }],
          "actionIds": ["items.save"]
        }
      }]
    }
  }
}
```

`root` 相对 Bundle，`entry` 和每个路由的 `entry` 相对项目根目录。页面默认导出 React component；默认入口处理未匹配路径，`routes` 声明其他路径和参数。宿主已装配 `HashRouter`，用 `Link` 或 `useNavigate` 导航，页面不要再套 Router。TS/TSX、JS/JSX、相对 import、动态 import、CSS 和可内联的图片/字体均可使用；没有独立静态文件服务，`public/` URL 不会被自动发布。页面首次加载等待 bridge ready，hook 可以直接读当前快照。项目根目录的 `styles.css` 会由底座自动加载，覆盖所有路由；其他 CSS 仍须从页面或组件显式 import，仅提交 CSS 文件不会自动生效。

## 默认包、组件和样式

- 默认有 React 18、React DOM、React Router 7、Lucide React、TypeScript 和 React 类型。
- `@setsuna/app` 复用宿主 `renderer-ui` 的公共组件：按钮/图标按钮、字段、下拉、复选框、开关、滑块、菜单、Popover、Tooltip、Dialog/ConfirmDialog、Tabs、表格、图片预览、ToastStack、Skeleton、ProgressRing、文件树等；`AppLayout`、`Panel` 和数据 hooks 继续由 SDK 提供。文案、标签、列和内容由应用提供。
- `Button.variant` 只有 `primary`、`secondary`、`ghost`、`danger`，另支持 `size`、`icon`、`loading`；图标按钮直接使用 `IconButton label="…"`。`TextField` 透传原生属性并支持可选 `label`、`leadingIcon`；`TextArea` 支持 `autoSize`。字段不支持 `hideLabel`，无可见标签时省略 `label` 并提供 `aria-label`。安装前检查 TS/TSX 类型，不依赖 Vite 忽略错误参数。
- `SelectField` 是宿主同款浮层下拉，使用 `value`、`onValueChange(value)` 和 `<option>` children，支持空字符串值、禁用项、`name` 和 `required`；不要使用原生 `select` 或向它传 `onChange(event)`。`Checkbox` 使用 `checked`、`onChange(event)` 和 `label`（或 children），也支持原生表单属性/ref；`Switch` 使用 `checked`、`onCheckedChange(boolean)` 和 `label`。
- 从 `lucide-react` 导入图标；图标按钮提供 `aria-label` 和 tooltip。
- 系统基础 CSS 自动加载，直接复用宿主主题 token 和控件样式，兼容 `--setsuna-*` 与 `sa-*` 布局资源。应用只需导入自己的 CSS；按组件声明通过 className/style 扩展。不要复制宿主控件 CSS 或把旧 `ui-components.js` 拼入 React 页面。
- 字段默认填满表单容器。放进筛选工具栏时，由应用指定下拉框的宽度或 flex/grid 轨道，让搜索框伸缩，并保留窄窗口换行；不要直接把全宽字段并列放进 flex-wrap 后就认为会保持一行。
- `Table` 接收 `rows`、`columns: [{key, header, render(row), align?, width?}]`、`getRowKey(row)`，可传 `caption`、`loading`、`emptyState`。`Dialog` 接收 `open`、`onClose`、children、可选 `title` 和 `footer`，应用管理开关状态；它与宿主共用焦点约束、Escape 和浮层定位。调用 `useConfirm` 时在所属应用外层挂载 `ConfirmationProvider`。
- `Markdown`（也可用 `DocumentMarkdown`）接收 `content`、可选 `baseUrl`、`className` 和 `onOpenLink(url)`；支持 GFM 表格、任务列表、代码块、emoji、标题锚点和经过过滤的 HTML。默认外链使用浏览器已有的打开流程；可用回调自行处理导航。它不访问文件系统、preload 或 runtime。不要自行注入 HTML 或重复安装 Markdown 解析器来实现基础阅读。

```tsx
import { useState } from 'react';
import { SelectField, Checkbox, Markdown } from '@setsuna/app';

export function Filters({ projects, description }: {
  projects: { id: string; name: string }[]; description: string;
}) {
  const [projectId, setProjectId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  return <>
    <SelectField aria-label="项目" value={projectId} onValueChange={setProjectId}>
      <option value="">全部项目</option>
      {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </SelectField>
    <Checkbox label="含归档" checked={includeArchived} onChange={event => setIncludeArchived(event.currentTarget.checked)} />
    <Markdown content={description} />
  </>;
}
```

```tsx
import { useState } from 'react';
import { AppLayout, Button, TextField, Link, useAppData, invokeAction } from '@setsuna/app';
import '../styles.css';

type View = { title?: string };
export default function Home() {
  const saved = useAppData<View>();
  const [draft, setDraft] = useState(saved.title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <AppLayout><form onSubmit={async event => {
    event.preventDefault();
    setSaving(true); setError('');
    try { await invokeAction('items.save', { title: draft }); }
    catch (error) { setError(String(error)); }
    finally { setSaving(false); }
  }}>
    <TextField label="标题" value={draft} onChange={event => setDraft(event.target.value)} required />
    <Button type="submit" disabled={saving}>保存</Button>
    {error && <div role="alert">{error}</div>}
  </form><Link to="/items/1">详情</Link></AppLayout>;
}
```

保留现有应用的设计；组件不要求统一业务布局。不要添加用户未要求的常驻解释、数据摘要、示例记录或引导文案。

上面页面的 `invokeAction('items.save', { title: draft })` 对应以下 worker。第二个参数进入 `input.payload`；`input.values` 只用于宿主 `tree` 的字符串表单。

```js
export default function activate(api) {
  api.onUiAction('items.save', async (input, context) => {
    const title = input?.payload?.title;
    if (typeof title !== 'string' || !title.trim() || title.length > 200) {
      throw new Error('标题无效');
    }
    const current = await context.state.get('items.view', 'global') ?? {};
    await context.state.set('items.view', { ...current, title: title.trim() }, 'global');
  });
}
```

写操作必须先校验 payload：缺失或类型错误时抛错，不要将错误输入兜底成空数组/空对象后写入状态。保留现有记录和其他字段。

## 依赖

项目有自己的 `package.json` 和依赖目录。新增浏览器兼容的 registry package 时写入该项目 dependencies，例如：

```json
{ "dependencies": { "zod": "4.4.3", "echarts": "6.1.0" } }
```

宿主补齐默认包和本地 `@setsuna/app`，在获批安装/更新时使用 pnpm 安装，先做 TypeScript 检查，再用 Vite 构建。不要手动访问 runtime 缓存或启动 Vite server；普通打开应用只读取已构建缓存。类型检查或构建失败时原版本和业务数据保留。

可提交 `pnpm-lock.yaml` 以固定版本；不提交依赖文件。支持 registry 的版本、范围和 tag，不支持 file/git/workspace 依赖、自定义 Vite/PostCSS 配置、Node CSS preprocessors、安装脚本或 Node 原生模块。包脚本不会运行。后端 extension 仍是自包含 `.mjs`；前端安装的包不会成为 worker 的依赖。

## 数据与权限

- `useAppData<T>()`、`useAppContext()`、`useAppSnapshot<T>()` 订阅现有 `setsunaUI` 快照。页面挂载时 bridge 已 ready；新应用的空状态 `{}` 或缺少 `todos` 等业务字段表示尚无记录，不能据此永久禁用输入。草稿由本地状态维护，只在保存成功或用户取消时清理，不要在每次快照变化时重置。
- `invokeAction(id, payload)` 调用 manifest `actionIds` 中的 action，交给 `api.onUiAction` handler；业务数据继续用同一 Plugin ID、stateKey、scope 和记录 ID。普通保存省略 action approval，确有确认需求时沿用现有审批规则。
- `requestRuntime({path,method?,body?})` 返回 `{ok,status,data}`，复用现有宿主后端通道；必须检查 ok。页面不持有本地端口、token、preload 或文件系统。
- 浏览器摄像头、麦克风、定位、剪贴板等继续由主进程权限处理器按页面审批；路由跳转不增加权限。
- `verify_plugin` 的 React 检查必须把页面提交的原始对象放在 `payload`，`values` 留空。保存检查用 `expectStateValues` 断言实际提交的关键值（如 `title`、`todos.0.title`）；`expectStatePaths` 只检查字段存在，空列表通过不能证明新增成功。验证必须使用用户要求的真实写入、明确实现的 dry-run，或读取后原样保存已有数据；禁止插入测试记录再清空用户状态。
- `verify_plugin` 覆盖真实 worker action、数据和 runtime API，不执行页面 JavaScript。按既有验证工作流报告范围，不声称已验证点击、弹窗或样式。
