---
name: "PDF 文档处理"
description: "读取、创建、检查、渲染并验证重视视觉版式的 PDF 文件。使用 Poppler 渲染，并通过 reportlab、pdfplumber、pypdf 等 Python 工具生成与提取内容。"
auto-activate:
  - pdf
  - Portable Document Format
---

# PDF 文档处理

## 工作流

1. 优先进行视觉检查：把 PDF 页面渲染为 PNG 并逐页查看。
   - 当前工作区或系统已有 Poppler 时使用 `pdftoppm`。
   - 不可用时安装 Poppler，或请用户在本地审阅输出。
2. 新建 PDF 时使用 `reportlab`。
3. 使用 `pdfplumber` 或 `pypdf` 提取文本并快速检查，但不要依赖文本提取判断版式是否正确。
4. 每次实质修改后重新渲染页面，检查对齐、间距和可读性。

## 临时文件与输出约定

- 中间文件放在 `tmp/pdfs/`，完成后删除。
- 在仓库中工作时，最终产物放在 `output/pdf/`。
- 文件名保持稳定且能说明用途。

## 依赖

优先使用当前工作区或 runtime 已有的依赖：

- Python 包：`reportlab`、`pdfplumber`、`pypdf`
- 渲染工具：Poppler 的 `pdftoppm` 和 `pdfinfo`

缺少依赖时，只安装实际需要的部分。

Python 包：

```bash
uv pip install reportlab pdfplumber pypdf
```

没有 `uv` 时：

```bash
python3 -m pip install reportlab pdfplumber pypdf
```

系统渲染工具：

```bash
# macOS（Homebrew）
brew install poppler

# Ubuntu/Debian
sudo apt-get install -y poppler-utils
```

当前环境无法安装时，告知用户缺少哪项依赖以及如何在本地安装。

## 环境变量

没有必需的环境变量。

## 渲染命令

```bash
pdftoppm -png "$INPUT_PDF" "$OUTPUT_PREFIX"
```

## 质量要求

- 保持字体、间距、边距和章节层级一致，形成完整的视觉设计。
- 避免文字裁切、元素重叠、表格损坏、黑色方块和无法识别的字形。
- 图表、表格和图片必须清晰、对齐且标注明确。
- 连字符仅用 ASCII `-`，避免 U+2011 和其他 Unicode 连接符。
- 引用和参考文献应便于阅读，不保留工具 token 或占位字符串。

## 最终检查

- 最新 PNG 检查确认没有视觉或格式缺陷后再交付。
- 确认页眉、页脚、页码和章节过渡完整、美观。
- 中间文件应整理好，或在最终批准后清除。
