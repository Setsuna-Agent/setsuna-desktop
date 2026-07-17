#!/usr/bin/env python3
"""Inspect DOCX structure and emit a bounded JSON report without modifying it."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC_NS = "http://purl.org/dc/elements/1.1/"
NS = {"w": W_NS, "r": R_NS, "pr": PACKAGE_REL_NS, "cp": CP_NS, "dc": DC_NS}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Input .docx file.")
    parser.add_argument("--json-out", type=Path, help="Optional JSON report path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    report = inspect_docx(input_path)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.json_out:
        output_path = args.json_out.expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


def inspect_docx(path: Path) -> dict[str, Any]:
    if path.suffix.lower() != ".docx":
        raise ValueError("Input must be a .docx file.")
    if not path.is_file():
        raise FileNotFoundError(f"Document not found: {path}")
    try:
        with ZipFile(path) as archive:
            names = set(archive.namelist())
            if "word/document.xml" not in names or "[Content_Types].xml" not in names:
                raise ValueError("The archive is missing required DOCX parts.")
            document = parse_part(archive, "word/document.xml")
            styles = parse_optional_part(archive, "word/styles.xml")
            comments = parse_optional_part(archive, "word/comments.xml")
            relationships = parse_optional_part(archive, "word/_rels/document.xml.rels")
            core = parse_optional_part(archive, "docProps/core.xml")

            paragraphs = document.findall(".//w:p", NS)
            paragraph_texts = [paragraph_text(paragraph) for paragraph in paragraphs]
            nonempty_paragraphs = [text for text in paragraph_texts if text.strip()]
            tables = document.findall(".//w:tbl", NS)
            sections = [section_geometry(section) for section in document.findall(".//w:sectPr", NS)]
            external_relationships = external_targets(relationships)
            tracked_insertions = len(document.findall(".//w:ins", NS))
            tracked_deletions = len(document.findall(".//w:del", NS))
            comment_count = len(comments.findall(".//w:comment", NS)) if comments is not None else 0
            field_count = len(document.findall(".//w:fldSimple", NS)) + len(document.findall(".//w:instrText", NS))
            media = sorted(name for name in names if name.startswith("word/media/") and not name.endswith("/"))
            warnings = build_warnings(
                nonempty_paragraphs=nonempty_paragraphs,
                styles=styles,
                tracked_insertions=tracked_insertions,
                tracked_deletions=tracked_deletions,
                comment_count=comment_count,
                external_relationships=external_relationships,
            )
            return {
                "path": str(path),
                "size": path.stat().st_size,
                "parts": len(names),
                "content": {
                    "paragraphs": len(paragraphs),
                    "nonemptyParagraphs": len(nonempty_paragraphs),
                    "tables": len(tables),
                    "media": len(media),
                    "contentControls": len(document.findall(".//w:sdt", NS)),
                    "fields": field_count,
                    "bookmarks": len(document.findall(".//w:bookmarkStart", NS)),
                },
                "revisions": {
                    "insertions": tracked_insertions,
                    "deletions": tracked_deletions,
                    "comments": comment_count,
                },
                "pageGeometry": sections,
                "externalRelationships": external_relationships,
                "metadata": core_metadata(core),
                "warnings": warnings,
            }
    except BadZipFile as error:
        raise ValueError(f"Not a valid DOCX ZIP archive: {path}") from error


def parse_part(archive: ZipFile, name: str) -> ET.Element:
    try:
        return ET.fromstring(archive.read(name))
    except ET.ParseError as error:
        raise ValueError(f"Invalid XML in {name}: {error}") from error


def parse_optional_part(archive: ZipFile, name: str) -> ET.Element | None:
    if name not in archive.namelist():
        return None
    return parse_part(archive, name)


def paragraph_text(paragraph: ET.Element) -> str:
    values: list[str] = []
    for node in paragraph.iter():
        if node.tag == f"{{{W_NS}}}t" and node.text:
            values.append(node.text)
        elif node.tag == f"{{{W_NS}}}tab":
            values.append("\t")
        elif node.tag in {f"{{{W_NS}}}br", f"{{{W_NS}}}cr"}:
            values.append("\n")
    return "".join(values)


def section_geometry(section: ET.Element) -> dict[str, int | None]:
    page_size = section.find("w:pgSz", NS)
    margins = section.find("w:pgMar", NS)
    return {
        "widthDxa": int_attr(page_size, "w:w"),
        "heightDxa": int_attr(page_size, "w:h"),
        "topDxa": int_attr(margins, "w:top"),
        "rightDxa": int_attr(margins, "w:right"),
        "bottomDxa": int_attr(margins, "w:bottom"),
        "leftDxa": int_attr(margins, "w:left"),
    }


def int_attr(element: ET.Element | None, name: str) -> int | None:
    if element is None:
        return None
    value = element.get(qname(name))
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def qname(name: str) -> str:
    prefix, local = name.split(":", 1)
    namespaces = {"w": W_NS}
    return f"{{{namespaces[prefix]}}}{local}"


def external_targets(relationships: ET.Element | None) -> list[dict[str, str]]:
    if relationships is None:
        return []
    result: list[dict[str, str]] = []
    for relationship in relationships.findall("pr:Relationship", NS):
        if relationship.get("TargetMode") != "External":
            continue
        result.append({
            "type": relationship.get("Type", ""),
            "target": relationship.get("Target", ""),
        })
    return result[:100]


def core_metadata(core: ET.Element | None) -> dict[str, str]:
    if core is None:
        return {}
    fields = {
        "title": "dc:title",
        "subject": "dc:subject",
        "creator": "dc:creator",
        "lastModifiedBy": "cp:lastModifiedBy",
        "keywords": "cp:keywords",
        "revision": "cp:revision",
    }
    result: dict[str, str] = {}
    for key, selector in fields.items():
        node = core.find(selector, NS)
        if node is not None and node.text:
            result[key] = node.text
    return result


def build_warnings(
    *,
    nonempty_paragraphs: list[str],
    styles: ET.Element | None,
    tracked_insertions: int,
    tracked_deletions: int,
    comment_count: int,
    external_relationships: list[dict[str, str]],
) -> list[str]:
    warnings: list[str] = []
    if not nonempty_paragraphs:
        warnings.append("Document contains no visible paragraph text.")
    if styles is None:
        warnings.append("Document has no word/styles.xml part.")
    if tracked_insertions or tracked_deletions:
        warnings.append("Document contains tracked changes; visible text depends on revision state.")
    if comment_count:
        warnings.append("Document contains comments that may not appear in headless rendering.")
    if external_relationships:
        warnings.append("Document contains external relationships; review them before sharing.")
    return warnings


if __name__ == "__main__":
    raise SystemExit(main())
