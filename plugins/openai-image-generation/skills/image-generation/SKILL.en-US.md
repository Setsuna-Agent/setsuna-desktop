---
name: "Image Generation"
description: "Create one or more new raster images using the configured OpenAI-compatible Images API. Use only when the user explicitly requests new visual assets, such as images, illustrations, posters, covers, or product images. Do not use for editing existing images or simple graphics better generated deterministically with SVG, HTML/CSS, or code."
auto-activate:
  - 生图
  - 生成图片
  - 图片生成
  - 画一张
  - 制作插画
  - 生成海报
  - generate image
  - create image
---

# Image Generation

Create new images with `generate_image`. Preserve the user's intent without adding unrequested people, brands, text, or narrative details.

## Workflow

1. Confirm that the request is for a new image. For edits, cutouts, or preserving existing image content, explain that this plugin does not yet support editing; do not present it as an editing tool.
2. Distinguish variations of one prompt from assets with different content:
   - Use `n` in one call for variations of the same prompt.
   - Call separately with an independent prompt for each distinct subject, purpose, or text. Do not use `n` as a substitute for different prompts.
3. Organize the subject, setting, style, composition, lighting, colors, materials, exact text, and required or prohibited elements.
4. Call the tool directly when information is sufficient. Ask only when missing information would materially change the result and cannot reasonably be inferred.
5. On success, briefly report the number of images. Do not print data URLs, service URLs, or API keys in the response.

## Prompt structure

Use the following order when helpful, writing a concise visual specification without mechanically filling every field:

```text
Purpose: where the image will be used
Subject and setting: main objects, environment, key details
Style and medium: photo, illustration, 3D, etc.
Composition: aspect ratio, viewpoint, subject placement, negative space
Lighting and colors: illumination, mood, palette
Text: "exact text that must appear verbatim"
Constraints: required elements, prohibited elements, watermarks, etc.
```

- When the user is specific, organize their description without embellishing it.
- When the request is broad, add only composition, lighting, or usage details that clearly improve the result.
- Quote image text verbatim and specify its placement; do not rewrite, translate, or invent copy.
- Reinforce easily lost requirements at the end of the prompt, stating what to generate and what to exclude.

## Parameters

- Pass only `prompt` by default and let the plugin use its configured model and service defaults.
- Set `size`, `quality`, `background`, `output_format`, or similar options only if requested or supported by the known target service.
- Use `model` only for an explicit user-requested override; do not guess model names.
- `n` counts variations of the same prompt only.
- Use `background: transparent` only when explicitly requested and supported by the service. Do not promise local background removal or native transparency.

## Constraints

- Never ask for, echo, or guess an API key in chat.
- If `generate_image` is unavailable, guide the user to “Capabilities → Plugins → Image Generation” to install the plugin and configure the service address and API key.
- Do not claim composition, text accuracy, or alpha channels were inspected; generated images are not automatically returned to the model for visual review.
- If the service rejects an optional parameter, remove it and retry at most once. Do not silently switch models or increase the image count.
