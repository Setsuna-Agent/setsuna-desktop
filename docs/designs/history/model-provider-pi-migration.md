# Model Provider Pi 迁移决策

状态：历史记录。普通采样协议迁移已完成；当前设置、超时、重试、目录和回放规则以 [Model Provider Feature](../../features/model-provider.md) 为准。

## 当时的问题

Runtime 同时维护 OpenAI Completions、OpenAI Responses 和 Anthropic Messages 的普通采样实现。协议适配、配置管理与 renderer 设置分散，升级和兼容修复需要同步多套实现。

## 采用的边界

- Pi 协议适配集中在 Model Provider Feature runtime；Core 保留 `ModelClient`、通用消息/事件、取消、工具、usage 与压缩调度。
- Pi 类型不进入共享 contracts、事件日志或数据库。持久 metadata 使用 Setsuna 自有格式，新写入为 v3，历史 v2 只读兼容。
- 保留原有 provider ID、协议持久值、配置位置和凭据 owner，避免协议替换同时引入无收益的数据搬迁。
- `/responses/compact` 保留窄原生 HTTP adapter，因为普通采样 SDK 不能替代这项能力。
- 删除旧普通 streaming client 与双栈切换开关；不提供运行时退回旧采样栈的分支。
- Renderer provider CRUD、目录与设置由同一个 Feature 持有，宿主仅提供窄能力与共享 UI。

## 后续演进

迁移时的零重试、idle timeout、初版 Pi dispatch 和设置布局已发生变化，不再保留施工清单、逐项测试数量或历史命令作为当前规范。协议升级应验证上下文转换、stream、取消、usage、历史回放与原生压缩，并以 owner 源码和现行文档为准。
