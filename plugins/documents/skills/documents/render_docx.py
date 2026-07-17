#!/usr/bin/env python3
"""通过 LibreOffice 渲染 DOCX，并将每个 PDF 页面栅格化为 PNG。"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Iterable


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Input .docx file.")
    parser.add_argument("--output-dir", required=True, type=Path, help="Fresh output directory for page PNGs.")
    parser.add_argument("--dpi", type=int, default=144, help="Raster resolution from 72 to 300 DPI.")
    parser.add_argument("--emit-pdf", action="store_true", help="Copy the intermediate PDF into the output directory.")
    parser.add_argument("--force", action="store_true", help="Allow replacing files created by an earlier render in this directory.")
    parser.add_argument("--timeout", type=int, default=120, help="LibreOffice timeout in seconds.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    if input_path.suffix.lower() != ".docx":
        raise ValueError("Input must be a .docx file.")
    if not input_path.is_file():
        raise FileNotFoundError(f"Document not found: {input_path}")
    if args.dpi < 72 or args.dpi > 300:
        raise ValueError("--dpi must be between 72 and 300.")
    if args.timeout < 10 or args.timeout > 600:
        raise ValueError("--timeout must be between 10 and 600 seconds.")
    output_dir.mkdir(parents=True, exist_ok=True)
    ensure_render_destination(output_dir, input_path, force=args.force)

    soffice = find_soffice()
    if not soffice:
        raise RuntimeError(
            "LibreOffice was not found. Install LibreOffice or set SETSUNA_SOFFICE_PATH "
            "to its soffice executable; structural checks may still be run without rendering."
        )

    with tempfile.TemporaryDirectory(prefix=".setsuna-docx-render-", dir=output_dir) as temporary:
        temporary_root = Path(temporary)
        converted_pdf = convert_to_pdf(input_path, temporary_root, soffice, timeout=args.timeout)
        pages = rasterize_pdf(converted_pdf, output_dir, dpi=args.dpi)
        emitted_pdf: Path | None = None
        if args.emit_pdf:
            emitted_pdf = output_dir / f"{input_path.stem}.pdf"
            shutil.copy2(converted_pdf, emitted_pdf)

    summary = {
        "input": str(input_path),
        "renderer": str(soffice),
        "dpi": args.dpi,
        "pageCount": len(pages),
        "pages": [str(path) for path in pages],
        **({"pdf": str(emitted_pdf)} if emitted_pdf else {}),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def ensure_render_destination(output_dir: Path, input_path: Path, *, force: bool) -> None:
    existing = sorted(output_dir.glob("page-*.png"))
    pdf_path = output_dir / f"{input_path.stem}.pdf"
    if not force and (existing or pdf_path.exists()):
        raise FileExistsError(
            f"Render output already exists in {output_dir}; choose a fresh directory or pass --force."
        )
    if force:
        for path in existing:
            path.unlink()
        pdf_path.unlink(missing_ok=True)


def find_soffice() -> Path | None:
    override = os.environ.get("SETSUNA_SOFFICE_PATH", "").strip()
    candidates: list[Path] = []
    if override:
        candidates.append(Path(override).expanduser())
    for command in ("soffice", "libreoffice"):
        resolved = shutil.which(command)
        if resolved:
            candidates.append(Path(resolved))

    system = platform.system().lower()
    if system == "darwin":
        candidates.extend([
            Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
            Path.home() / "Applications/LibreOffice.app/Contents/MacOS/soffice",
        ])
    elif system == "windows":
        for root_name in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
            root = os.environ.get(root_name)
            if root:
                candidates.append(Path(root) / "LibreOffice/program/soffice.exe")
    else:
        candidates.extend([
            Path("/usr/bin/libreoffice"),
            Path("/usr/bin/soffice"),
            Path("/snap/bin/libreoffice"),
        ])

    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        if candidate.is_file():
            return candidate.resolve()
    return None


def convert_to_pdf(input_path: Path, temporary_root: Path, soffice: Path, *, timeout: int) -> Path:
    conversion_dir = temporary_root / "converted"
    profile_dir = temporary_root / "profile"
    conversion_dir.mkdir(parents=True, exist_ok=True)
    profile_dir.mkdir(parents=True, exist_ok=True)
    command = [
        str(soffice),
        f"-env:UserInstallation={profile_dir.resolve().as_uri()}",
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--nofirststartwizard",
        "--convert-to",
        "pdf:writer_pdf_Export",
        "--outdir",
        str(conversion_dir),
        str(input_path),
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"LibreOffice rendering timed out after {timeout} seconds.") from error
    pdfs = sorted(conversion_dir.glob("*.pdf"), key=lambda path: path.stat().st_mtime, reverse=True)
    if result.returncode != 0 or not pdfs:
        details = "\n".join(value.strip() for value in (result.stdout, result.stderr) if value.strip())
        raise RuntimeError(
            f"LibreOffice failed to convert {input_path} (exit {result.returncode})."
            + (f"\n{details[-4000:]}" if details else "")
        )
    return pdfs[0]


def rasterize_pdf(pdf_path: Path, output_dir: Path, *, dpi: int) -> list[Path]:
    try:
        import fitz
    except ImportError as error:
        raise RuntimeError(
            "PyMuPDF is unavailable. Run this script through uv with the bundled requirements.txt."
        ) from error
    pages: list[Path] = []
    scale = dpi / 72
    with fitz.open(pdf_path) as document:
        if document.page_count < 1:
            raise RuntimeError("The rendered PDF contains no pages.")
        for page_index, page in enumerate(document, start=1):
            destination = output_dir / f"page-{page_index:03d}.png"
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            pixmap.save(destination)
            pages.append(destination)
    return pages


if __name__ == "__main__":
    raise SystemExit(main())
