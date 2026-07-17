#!/usr/bin/env python3
"""根据 Setsuna Documents 的 JSON 内容模型创建 DOCX 文件。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from document_builder import build_document, load_json_object


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", required=True, type=Path, help="UTF-8 JSON content specification.")
    parser.add_argument("--output", required=True, type=Path, help="Destination .docx path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    spec_path = args.spec.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    if spec_path.suffix.lower() != ".json":
        raise ValueError("--spec must point to a .json file.")
    if output_path.suffix.lower() != ".docx":
        raise ValueError("--output must end in .docx.")
    if not spec_path.is_file():
        raise FileNotFoundError(f"Specification not found: {spec_path}")

    document = build_document(load_json_object(spec_path), spec_path.parent)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    document.save(output_path)
    print(json.dumps({
        "output": str(output_path),
        "size": output_path.stat().st_size,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
