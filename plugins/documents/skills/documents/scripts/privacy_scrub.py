#!/usr/bin/env python3
"""在保留内容的同时，从 DOCX 副本中移除常见个人元数据。"""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path
from uuid import uuid4
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile


CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC_NS = "http://purl.org/dc/elements/1.1/"
DCTERMS_NS = "http://purl.org/dc/terms/"
CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
RSID_ATTRIBUTE = re.compile(rb"\s+w:rsid[A-Za-z0-9]*=\"[^\"]*\"")

ET.register_namespace("cp", CP_NS)
ET.register_namespace("dc", DC_NS)
ET.register_namespace("dcterms", DCTERMS_NS)
ET.register_namespace("", CONTENT_TYPES_NS)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Source .docx file.")
    parser.add_argument("--output", required=True, type=Path, help="Sanitized .docx copy.")
    parser.add_argument("--remove-timestamps", action="store_true", help="Also remove core created/modified timestamps.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    if input_path.suffix.lower() != ".docx" or output_path.suffix.lower() != ".docx":
        raise ValueError("--input and --output must be .docx files.")
    if input_path == output_path:
        raise ValueError("Privacy cleanup must write a new file.")
    if not input_path.is_file():
        raise FileNotFoundError(f"Input document not found: {input_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_name(f".{output_path.name}.{uuid4().hex}.tmp")
    try:
        scrub_docx(input_path, temporary_path, remove_timestamps=args.remove_timestamps)
        with ZipFile(temporary_path) as archive:
            if archive.testzip() is not None or "word/document.xml" not in archive.namelist():
                raise ValueError("Sanitized output failed DOCX ZIP validation.")
        os.replace(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)
    print(f"Sanitized {input_path} -> {output_path}")
    return 0


def scrub_docx(input_path: Path, output_path: Path, *, remove_timestamps: bool) -> None:
    try:
        with ZipFile(input_path) as source, ZipFile(output_path, "w", compression=ZIP_DEFLATED) as destination:
            for info in source.infolist():
                if info.filename == "docProps/custom.xml":
                    continue
                data = source.read(info.filename)
                if info.filename == "docProps/core.xml":
                    data = scrub_core_properties(data, remove_timestamps=remove_timestamps)
                elif info.filename == "[Content_Types].xml":
                    data = remove_custom_property_content_type(data)
                elif info.filename == "_rels/.rels":
                    data = remove_custom_property_relationship(data)
                elif info.filename.startswith("word/") and info.filename.endswith(".xml"):
                    data = RSID_ATTRIBUTE.sub(b"", data)
                destination.writestr(info, data)
    except BadZipFile as error:
        raise ValueError(f"Not a valid DOCX ZIP archive: {input_path}") from error


def scrub_core_properties(data: bytes, *, remove_timestamps: bool) -> bytes:
    root = ET.fromstring(data)
    for selector in (f"{{{DC_NS}}}creator", f"{{{CP_NS}}}lastModifiedBy"):
        node = root.find(selector)
        if node is not None:
            node.text = ""
    revision = root.find(f"{{{CP_NS}}}revision")
    if revision is not None:
        revision.text = "1"
    if remove_timestamps:
        for selector in (
            f"{{{DCTERMS_NS}}}created",
            f"{{{DCTERMS_NS}}}modified",
            f"{{{CP_NS}}}lastPrinted",
        ):
            node = root.find(selector)
            if node is not None:
                root.remove(node)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def remove_custom_property_content_type(data: bytes) -> bytes:
    root = ET.fromstring(data)
    for node in list(root):
        if node.get("PartName") == "/docProps/custom.xml":
            root.remove(node)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def remove_custom_property_relationship(data: bytes) -> bytes:
    root = ET.fromstring(data)
    for node in list(root):
        target = (node.get("Target") or "").replace("\\", "/")
        if target.endswith("docProps/custom.xml") or target.endswith("/custom.xml"):
            root.remove(node)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    raise SystemExit(main())
