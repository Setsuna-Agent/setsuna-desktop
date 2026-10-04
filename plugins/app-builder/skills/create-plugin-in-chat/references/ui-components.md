# 公共组件与图标

这些资源可直接放入 HTML/JS 沙箱应用，使用系统主题与 `sa-*` 样式。宿主内部的 React 组件无需也不能直接导入。

## 接入

通过 `read_plugin_resource({pluginId:'app-builder',resourceId:...})` 读取：

| 资源 ID | 内容 |
| --- | --- |
| `ui-base` | 按钮、字段、表格、面板、徽章、标签页、弹窗的共享 CSS |
| `ui-components` | `window.SetsunaComponents`：原生 DOM 组件与交互 |
| `ui-icons` | `window.SetsunaIcons`：80 个离线 Lucide SVG 图标 |

把 CSS 写入应用自己的样式文件。将所需脚本按 **ui-icons → ui-components → 应用逻辑** 顺序拼接为自己的 `ui/app.js`，通过 `document.jsResourceId` 加载。只需图标时可以省略组件脚本。保留图标文件开头的版权许可。不要加外部 script/link，不要在 `document.libraries` 中声明 `lucide` 或 `setsuna-ui`，它们不是宿主注入库。

脚本执行完才有上述全局对象；这些 DOM 组件不依赖 `setsunaUI.ready`。访问后端或状态仍要走既有 `setsunaUI` 桥。返回的真实 DOM 节点可以设置原生属性和事件；不需要额外的框架、渲染器或重新实现键盘状态。

## 组件目录

| 调用 | 参数 / 返回值 |
| --- | --- |
| `button(options)` | `label, icon?, iconOnly?, variant?, disabled?, onClick?`；返回 `HTMLButtonElement`，默认 type=button；variant 为 default/primary/ghost/danger |
| `field(options)` | `label, name, type?, value?, required?, onInput?`；返回 `{element,input}`，type 支持原生 input 类型或 textarea；onInput 接收字符串 |
| `select(options)` | `label, name, options:[{label,value,disabled?}], value?, required?, onChange?`；返回 `{element,input}`；onChange 接收字符串 |
| `tabs(options)` | `items:[{id,label,content,disabled?}], value?, label?, onChange?`；content 是 DOM 节点；返回 `{element,value,setValue(id)}` |
| `dialog(options)` | `title, content, closeLabel, onClose?`；content 是 DOM 节点；返回 `{element,open(initialFocus?),close(value?),destroy()}` |

标签页支持左右键、Home/End、跳过禁用项和关联面板，切换时保留面板里的输入。`onChange` 只在选中项改变时触发。弹窗创建后挂载到当前文档，调用 `open()` 才显示；使用原生 modal 焦点约束和 Escape 关闭，关闭后恢复打开前的焦点，`onClose` 接收 returnValue。不再使用时 `destroy()`。不要跨刷新重复创建而不清理。

简单提示、确认和输入可直接使用宿主兼容的同步 `window.alert/confirm/prompt`；`confirm` 取消返回 `false`，`prompt` 取消返回 `null`，空字符串仍是确认后的有效返回值。复杂编辑器使用页面内的 `dialog`（原生 `<dialog>`），结合 `field`、校验和异步保存；只有确认且保存成功才关闭，失败保留输入。关闭按钮和 Escape 只取消，不触发保存或删除。

表格、复选框、面板、状态徽章直接使用 HTML + `ui-base`，表格/表单结构见 `ui-patterns`。数据校验、保存、排序和业务规则由应用实现，组件不会替你请求或修改数据。

```js
const UI = window.SetsunaComponents;
const name = UI.field({ label: '名称', name: 'name', required: true });
name.input.maxLength = 120;
const form = document.createElement('form');
form.className = 'sa-stack';
form.addEventListener('submit', (event) => event.preventDefault());
form.append(name.element);
const editor = UI.dialog({ title: '编辑记录', content: form, closeLabel: '关闭' });
const edit = UI.button({ label: '编辑', icon: 'pencil', onClick: () => editor.open(name.input) });
document.querySelector('#actions').append(edit);
// 在 form 中追加真实保存操作；校验、保存成功后再 editor.close('saved')。
window.addEventListener('pagehide', () => editor.destroy(), { once: true });
```

只有需求包含这些控件时才使用示例；按界面语言传入文案。异步保存期间用原生 `disabled`/`aria-busy` 控制重复操作，失败保留表单。不要让组件帮助函数代替未实现的业务逻辑。

## 图标

```js
const icon = window.SetsunaIcons.create('search');
document.querySelector('#search-label').prepend(icon);
// 独立表达含义的图标需要 label；伴随按钮文字的图标默认 aria-hidden。
const status = window.SetsunaIcons.create('circle-check', { size: 20, label: '已完成' });
// HTML 占位写成 <span data-sa-icon="search"></span> 后统一填充。
window.SetsunaIcons.mount(document.querySelector('#app'));
```

`create` 返回 SVG 元素，尺寸默认 16px，颜色跟随 currentColor；`mount` 填充容器后代中的 `[data-sa-icon]`，动态新增内容后再调用。可用名称以 `SetsunaIcons.names` 为准，不支持的名称会明确报错。图标按钮必须同时提供可读的 `label`，组件自动设 tooltip 和 aria-label。

| 用途 | 常用名称 |
| --- | --- |
| 编辑 | plus, minus, x, check, pencil, trash-2, copy, clipboard, save |
| 查询与排序 | search, filter, arrow-up-down, refresh-cw, rotate-ccw, sliders-horizontal |
| 导航与操作 | chevron-down, chevron-up, chevron-left, chevron-right, arrow-left, arrow-right, arrow-up-right, more-horizontal, more-vertical, external-link, link, download, upload |
| 应用与数据 | home, layout-dashboard, panels-top-left, table-2, columns-3, rows-3, list, list-checks, chart-column, chart-line, chart-pie, database |
| 文件与协作 | file, file-text, file-spreadsheet, folder, folder-open, calendar, clock, user, users, mail, phone, message-square, messages-square, send |
| 状态与其他 | info, circle-help, circle-check, triangle-alert, loader-circle, eye, eye-off, lock, unlock, settings, tag, bookmark, star, heart, bell, sun, moon |

使用既有含义选择图标，不用 emoji 或随机彩色图案替代功能按钮；应用头像的预制图标是另一种用途。图标数据由仓库当前 `lucide-react` 生成，不联网、无 React 运行时依赖。维护者修改图标集合或升级依赖后运行 `pnpm generate:app-icons`，不要手工改生成的路径数据。
