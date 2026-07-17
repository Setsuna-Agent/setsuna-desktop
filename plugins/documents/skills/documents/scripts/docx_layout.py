"""Shared layout and OOXML helpers for the Setsuna Documents plugin."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Mm, Pt, RGBColor, Twips


@dataclass(frozen=True)
class DocumentPreset:
    name: str
    page_size: str
    margins_mm: tuple[float, float, float, float]
    body_font: str
    east_asia_font: str
    body_size_pt: float
    body_line_spacing: float
    paragraph_after_pt: float
    title_size_pt: float
    subtitle_size_pt: float
    heading_sizes_pt: tuple[float, float, float]
    accent: str
    text: str
    muted: str
    table_header_fill: str
    callout_fill: str
    table_cell_margin_dxa: int


PRESETS: dict[str, DocumentPreset] = {
    "business": DocumentPreset(
        name="business",
        page_size="a4",
        margins_mm=(20, 22, 20, 22),
        body_font="Arial",
        east_asia_font="Microsoft YaHei",
        body_size_pt=10.5,
        body_line_spacing=1.16,
        paragraph_after_pt=6,
        title_size_pt=25,
        subtitle_size_pt=12,
        heading_sizes_pt=(16, 13, 11),
        accent="315E7D",
        text="1F2933",
        muted="647383",
        table_header_fill="315E7D",
        callout_fill="EAF2F7",
        table_cell_margin_dxa=120,
    ),
    "compact": DocumentPreset(
        name="compact",
        page_size="a4",
        margins_mm=(17, 18, 17, 18),
        body_font="Arial",
        east_asia_font="Microsoft YaHei",
        body_size_pt=9.5,
        body_line_spacing=1.08,
        paragraph_after_pt=4,
        title_size_pt=22,
        subtitle_size_pt=10.5,
        heading_sizes_pt=(14, 12, 10.5),
        accent="4F5D75",
        text="202833",
        muted="697386",
        table_header_fill="4F5D75",
        callout_fill="EEF0F4",
        table_cell_margin_dxa=90,
    ),
}


ALIGNMENTS = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}


def preset_by_name(value: Any) -> DocumentPreset:
    name = str(value or "business").strip().lower()
    if name not in PRESETS:
        raise ValueError(f"Unknown design preset: {name}. Expected one of {', '.join(PRESETS)}.")
    return PRESETS[name]


def configure_new_document(document: Any, preset: DocumentPreset, page_size: str | None = None) -> None:
    """Apply page geometry and a deterministic style sheet to a new document."""

    configure_page(document.sections[0], page_size or preset.page_size, preset.margins_mm)
    normal = document.styles["Normal"]
    apply_style_font(normal, preset.body_font, preset.east_asia_font, preset.body_size_pt, preset.text)
    normal.paragraph_format.line_spacing = preset.body_line_spacing
    normal.paragraph_format.space_after = Pt(preset.paragraph_after_pt)
    normal.paragraph_format.widow_control = True

    ensure_support_styles(document, preset)
    for level, size in enumerate(preset.heading_sizes_pt, start=1):
        style = document.styles[f"Heading {level}"]
        apply_style_font(style, preset.body_font, preset.east_asia_font, size, preset.accent, bold=True)
        style.paragraph_format.space_before = Pt(13 if level == 1 else 9)
        style.paragraph_format.space_after = Pt(5 if level == 1 else 3)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.widow_control = True

    caption = document.styles["Caption"]
    apply_style_font(caption, preset.body_font, preset.east_asia_font, 8.5, preset.muted, italic=True)
    caption.paragraph_format.space_before = Pt(3)
    caption.paragraph_format.space_after = Pt(8)


def configure_page(section: Any, page_size: str, margins_mm: Sequence[float]) -> None:
    normalized = str(page_size).strip().lower()
    if normalized == "a4":
        section.page_width = Mm(210)
        section.page_height = Mm(297)
    elif normalized == "letter":
        section.page_width = Inches(8.5)
        section.page_height = Inches(11)
    else:
        raise ValueError("pageSize must be 'a4' or 'letter'.")
    top, right, bottom, left = margins_mm
    section.top_margin = Mm(top)
    section.right_margin = Mm(right)
    section.bottom_margin = Mm(bottom)
    section.left_margin = Mm(left)


def ensure_support_styles(document: Any, preset: DocumentPreset) -> None:
    title = ensure_paragraph_style(document, "Setsuna Title")
    apply_style_font(title, preset.body_font, preset.east_asia_font, preset.title_size_pt, preset.accent, bold=True)
    title.paragraph_format.space_before = Pt(0)
    title.paragraph_format.space_after = Pt(4)
    title.paragraph_format.keep_with_next = True

    subtitle = ensure_paragraph_style(document, "Setsuna Subtitle")
    apply_style_font(subtitle, preset.body_font, preset.east_asia_font, preset.subtitle_size_pt, preset.muted)
    subtitle.paragraph_format.space_before = Pt(0)
    subtitle.paragraph_format.space_after = Pt(9)
    subtitle.paragraph_format.keep_with_next = True


def ensure_paragraph_style(document: Any, name: str) -> Any:
    try:
        return document.styles[name]
    except KeyError:
        return document.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)


def apply_style_font(
    style: Any,
    latin_font: str,
    east_asia_font: str,
    size_pt: float,
    color: str,
    *,
    bold: bool = False,
    italic: bool = False,
) -> None:
    style.font.name = latin_font
    style.font.size = Pt(size_pt)
    style.font.bold = bold
    style.font.italic = italic
    style.font.color.rgb = RGBColor.from_string(normalize_hex_color(color))
    r_pr = style.element.get_or_add_rPr()
    fonts = r_pr.get_or_add_rFonts()
    fonts.set(qn("w:ascii"), latin_font)
    fonts.set(qn("w:hAnsi"), latin_font)
    fonts.set(qn("w:eastAsia"), east_asia_font)


def apply_run_font(
    run: Any,
    preset: DocumentPreset,
    *,
    color: str | None = None,
    size_pt: float | None = None,
    code: bool = False,
) -> None:
    latin_font = "Consolas" if code else preset.body_font
    east_asia_font = preset.east_asia_font
    run.font.name = latin_font
    run.font.size = Pt(size_pt or preset.body_size_pt)
    run.font.color.rgb = RGBColor.from_string(normalize_hex_color(color or preset.text))
    r_pr = run._element.get_or_add_rPr()
    fonts = r_pr.get_or_add_rFonts()
    fonts.set(qn("w:ascii"), latin_font)
    fonts.set(qn("w:hAnsi"), latin_font)
    fonts.set(qn("w:eastAsia"), east_asia_font)


def usable_width_dxa(section: Any) -> int:
    return int(
        section.page_width.twips
        - section.left_margin.twips
        - section.right_margin.twips
    )


def paragraph_alignment(value: Any, default: str = "left") -> Any:
    name = str(value or default).strip().lower()
    if name not in ALIGNMENTS:
        raise ValueError(f"Unknown paragraph alignment: {name}.")
    return ALIGNMENTS[name]


def set_paragraph_panel(paragraph: Any, fill: str, border: str) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    shading = p_pr.find(qn("w:shd"))
    if shading is None:
        shading = OxmlElement("w:shd")
        p_pr.append(shading)
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:fill"), normalize_hex_color(fill))

    borders = p_pr.find(qn("w:pBdr"))
    if borders is None:
        borders = OxmlElement("w:pBdr")
        p_pr.append(borders)
    left = borders.find(qn("w:left"))
    if left is None:
        left = OxmlElement("w:left")
        borders.append(left)
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), "20")
    left.set(qn("w:space"), "8")
    left.set(qn("w:color"), normalize_hex_color(border))


def set_paragraph_rule(paragraph: Any, color: str) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    borders = p_pr.find(qn("w:pBdr"))
    if borders is None:
        borders = OxmlElement("w:pBdr")
        p_pr.append(borders)
    bottom = borders.find(qn("w:bottom"))
    if bottom is None:
        bottom = OxmlElement("w:bottom")
        borders.append(bottom)
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), normalize_hex_color(color))


def set_cell_fill(cell: Any, color: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shading = tc_pr.find(qn("w:shd"))
    if shading is None:
        shading = OxmlElement("w:shd")
        tc_pr.append(shading)
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:fill"), normalize_hex_color(color))


def set_cell_margins(cell: Any, margin_dxa: int) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.find(qn("w:tcMar"))
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for edge in ("top", "start", "bottom", "end"):
        node = tc_mar.find(qn(f"w:{edge}"))
        if node is None:
            node = OxmlElement(f"w:{edge}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(max(0, int(margin_dxa))))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row: Any) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    header = tr_pr.find(qn("w:tblHeader"))
    if header is None:
        header = OxmlElement("w:tblHeader")
        tr_pr.append(header)
    header.set(qn("w:val"), "true")


def set_table_geometry(table: Any, widths_dxa: Sequence[int]) -> None:
    if len(widths_dxa) != len(table.columns):
        raise ValueError("Table width count must match its column count.")
    if any(width <= 0 for width in widths_dxa):
        raise ValueError("Table column widths must be positive.")

    total = sum(int(width) for width in widths_dxa)
    table.autofit = False
    tbl_pr = table._tbl.tblPr

    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(total))
    tbl_w.set(qn("w:type"), "dxa")

    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")

    indent = tbl_pr.find(qn("w:tblInd"))
    if indent is None:
        indent = OxmlElement("w:tblInd")
        tbl_pr.append(indent)
    indent.set(qn("w:w"), "0")
    indent.set(qn("w:type"), "dxa")

    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths_dxa:
        column = OxmlElement("w:gridCol")
        column.set(qn("w:w"), str(int(width)))
        grid.append(column)

    for row in table.rows:
        for cell, width in zip(row.cells, widths_dxa):
            cell.width = Twips(int(width))
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.find(qn("w:tcW"))
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(int(width)))
            tc_w.set(qn("w:type"), "dxa")


def normalize_hex_color(value: Any) -> str:
    normalized = str(value or "").strip().lstrip("#").upper()
    if len(normalized) != 6 or any(character not in "0123456789ABCDEF" for character in normalized):
        raise ValueError(f"Invalid RGB color: {value!r}.")
    return normalized
