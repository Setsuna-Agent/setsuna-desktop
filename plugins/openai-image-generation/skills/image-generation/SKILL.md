---
name: "图片生成"
description: "Use the configured OpenAI-compatible Images API to generate new images from a text prompt."
auto-activate:
  - 生图
  - 生成图片
  - 图片生成
  - generate image
  - create image
metadata:
  short-description: "使用 OpenAI 兼容接口生成图片"
---

# 图片生成

当用户明确要求创建一张或多张新图片时使用本 Skill。

## 工作流

1. 从用户描述中整理画面主体、构图、风格、光线、色彩、文字和尺寸要求。
2. 信息足够时直接调用 `generate_image`，把完整视觉要求写入 `prompt`。
3. 仅在会实质改变结果且无法合理推断时追问；不要重复确认已经明确的要求。
4. 工具成功后简短说明图片已经生成，不要把数据 URL 或服务端返回地址输出到聊天正文。

## 约束

- 不要在聊天中索要、回显或猜测 API key。
- `generate_image` 不可用时，引导用户前往“能力 -> 插件 -> 图片生成”安装插件并填写服务地址与 API key。
- 本插件只生成新图片，不把它当成现有图片编辑工具。
- 参数以目标服务支持范围为准；不确定时只传 `prompt`、已配置的模型和用户明确要求的标准参数。
