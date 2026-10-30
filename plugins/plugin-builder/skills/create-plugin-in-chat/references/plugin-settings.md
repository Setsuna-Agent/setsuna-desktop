# 插件详情配置表单

用户只需要配置插件时，将 `tree` 放在 `renderer.capabilities.plugin.details`，不创建侧栏应用。每个插件只能有一个详情表单。沿用宿主控件，无需 React 项目、页面资源、CSS 或 `navigation`。

## 一个 API Key 字段

下面是可直接提交给 `configure_plugin` 的完整示例；按实际插件修改 ID 和名称，更新已有插件时保留其余文件、工具与能力。

```json
{
  "manifest": {
    "id": "service-search",
    "name": "服务搜索",
    "extension": {
      "apiVersion": 1,
      "runtime": "node-worker",
      "entry": "extension/entry.mjs",
      "capabilities": ["ui"],
      "rendererUi": {
        "schemaVersion": 2,
        "actions": [{ "id": "settings.save" }],
        "contributions": [{
          "id": "settings",
          "slot": "renderer.capabilities.plugin.details",
          "tree": {
            "type": "stack",
            "children": [
              { "type": "field", "name": "apiKey", "label": "API Key", "secret": true },
              { "type": "button", "actionId": "settings.save", "label": "保存", "variant": "primary" }
            ]
          }
        }]
      }
    }
  },
  "files": [{
    "path": "extension/entry.mjs",
    "content": "export default function activate(api) { api.onUiAction('settings.save', async () => {}); }\n"
  }]
}
```

这里的空 save handler 是有意的：宿主会在调用 handler 前保存密钥修改。只有密钥时不需要 `state` capability 或 `data`。普通保存不声明 `approval`。

- `secret: true` 仅用于 schema v2 的插件详情字段，不能设置 `defaultValue`，也不能把真实 API Key 放入 manifest、文件或工具参数。
- 用户在详情表单填写密钥；留空保留旧值，清除图标标记删除，点击保存后生效。`required: true` 会阻止保存缺失的密钥，因此允许清除配置时应省略它，工具执行时再检查是否配置。
- 宿主使用系统加密凭据库，界面只收到是否已配置。密钥修改不会进入 `input.values`、普通 state 或表单回填。
- 保存后 handler 失败不回滚已保存的密钥；测试按钮也会先应用当前编辑值，再执行测试。需要测试按钮时声明对应 action 并注册实际 handler。
- 插件卸载会删除凭据；稳定的插件 ID 和字段 name 可在更新后继续使用已有配置。

## 在实际工具中使用

在已有 `execute(input, context)` 或 UI action handler 中读取密钥；`activate(api)` 没有 `secrets`。无需额外 capability，宿主只允许读取本插件详情中声明的密钥字段。

```js
const apiKey = await context.secrets.get('apiKey');
if (!apiKey) throw new Error('请先在插件详情中配置 API Key。');
```

将它用于实际服务请求的认证头；请求仍需声明 `network` 和真实服务的准确 `allowedOrigins`。不要把密钥返回到工具结果、错误、日志或页面状态。

## 普通配置字段

普通 `field` / `select` 和密钥可放在同一个 `tree`。普通字段使用 `input.values`，并通过 `context.state.set` 保存；此时声明 `state` 和 `data: { "stateKey": "settings", "scope": "global" }`。以 `defaultValue: { "path": "city" }` 绑定普通字段，在 save handler 中写入 `{ city: input.values.city }`。不要为密钥建立任何 state 绑定。

## 验证

安装后，用 `verify_plugin` 的 `ui-action` 检查 `settings.save`，指定 `contributionId: "settings"` 和普通字段的 `values`；密钥由用户在详情页输入，不通过验证工具提交。需要外部服务的检查在用户配置后进行；缺少密钥时明确说明尚未验证服务调用，不宣称已经通过。


Schema v2 的数字和布尔配置使用宿主标量控件，例如 `{ "type": "number", "name": "strength", "label": "强度", "defaultValue": 0.5, "min": 0, "max": 1, "step": 0.1 }` 和 `{ "type": "boolean", "name": "enabled", "label": "启用", "defaultValue": false }`。默认值使用 JSON 数字/布尔值，action 的 `input.values` 为兼容旧 handler 仍使用字符串。需要实际数字/布尔值时显式转换再保存；宿主会校验数值范围、步长与必填规则，恢复状态时也丢弃无效值。
