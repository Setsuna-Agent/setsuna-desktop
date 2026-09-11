# 渲染与验证工作流

1. 在工作区新建空目录存放渲染结果。
2. 运行 `render_docx.py <input.docx> --output-dir <dir> --emit-pdf`。
3. 确认 JSON 摘要至少报告一页。
4. 支持图片输入时，用 `view_image` 打开每张 `page-<NNN>.png`。
5. 检查裁切、重叠、缺字、过密表格、孤立标题、意外空白页和不一致的页眉页脚。
6. 修正源文档并渲染到另一个新目录。

LibreOffice 负责 DOCX 转 PDF，`PyMuPDF` 将 PDF 栅格化。缺少 LibreOffice 时仅报告结构验证，不要静默换用版式行为不同的无关渲染器。
