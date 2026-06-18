"""Lightweight PDF text extraction with multiple backends.

Extraction priority:
1. PyMuPDF (fitz) – best quality, handles virtually all PDFs.
2. pdftotext (poppler-utils) – good layout-preserving fallback.
3. Internal Flate stream decoder – zero-dependency last resort for the
   Chromium/Skia PDFs commonly produced by SEC filing renderers.
"""

from __future__ import annotations

import html
import re
import subprocess
import zlib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ExtractionResult:
    text: str
    method: str
    confidence: float
    warnings: list[str]


def extract_text(path: Path) -> ExtractionResult:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md", ".csv"}:
        return ExtractionResult(path.read_text(errors="ignore"), "plain-text", 1.0, [])
    if suffix == ".html" or suffix == ".htm":
        raw = path.read_text(errors="ignore")
        return ExtractionResult(_clean_html(raw), "html", 0.95, [])
    if suffix != ".pdf":
        return ExtractionResult(path.read_text(errors="ignore"), "text-fallback", 0.55, [])

    # --- PyMuPDF (fitz) – highest quality ---
    pymupdf_text = _extract_with_pymupdf(path)
    if pymupdf_text and len(pymupdf_text.strip()) > 500:
        return ExtractionResult(pymupdf_text, "pymupdf", 0.97, [])

    # --- pdftotext (poppler-utils) ---
    external = _extract_with_pdftotext(path)
    if external and len(external.strip()) > 500:
        return ExtractionResult(external, "pdftotext", 0.95, [])

    # --- Internal Flate stream decoder (zero-dependency fallback) ---
    text = _extract_pdf_stream_text(path.read_bytes())
    confidence = 0.78 if len(text) > 1000 else 0.35
    warnings = []
    if confidence < 0.6:
        warnings.append(
            "PDF text extraction produced limited text. "
            "Install PyMuPDF (`pip install pymupdf`) for better results, "
            "or for scanned PDFs, run OCR first."
        )
    return ExtractionResult(text, "internal-pdf-stream-decoder", confidence, warnings)


def _extract_with_pymupdf(path: Path) -> str | None:
    """Extract text using PyMuPDF (fitz). Returns None if unavailable."""
    try:
        import fitz  # type: ignore
    except ImportError:
        return None

    try:
        doc = fitz.open(str(path))
    except Exception:
        return None

    pages: list[str] = []
    try:
        for page in doc:
            text = page.get_text("text")
            if text and text.strip():
                pages.append(text)
    except Exception:
        pass
    finally:
        doc.close()

    full = "\n\n".join(pages)
    return _normalize_text(full) if full.strip() else None


def _extract_with_pdftotext(path: Path) -> str | None:
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            check=False,
            capture_output=True,
            text=True,
            timeout=25,
        )
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        return None
    return result.stdout if result.returncode == 0 else None


def _extract_pdf_stream_text(data: bytes) -> str:
    pages: list[str] = []
    for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        chunk = match.group(1)
        try:
            decoded = zlib.decompress(chunk)
        except zlib.error:
            continue
        page_text = _decode_content_stream(decoded)
        if page_text.strip():
            pages.append(page_text)
    return _normalize_text("\n\n".join(pages))


def _decode_content_stream(stream: bytes) -> str:
    # Pull text shown by Tj/TJ operators. This ignores precise positioning, but
    # inserts line breaks at text object boundaries and enough spacing for tables.
    parts: list[str] = []
    for text_object in re.findall(rb"BT(.*?)ET", stream, re.S):
        tokens = re.finditer(
            rb"<([0-9A-Fa-f]+)>\s*Tj|\((.*?)\)\s*Tj|\[(.*?)\]\s*TJ|(-?\d+(?:\.\d+)?)\s+0\s+Td",
            text_object,
            re.S,
        )
        line: list[str] = []
        for token in tokens:
            if token.group(4):
                try:
                    advance = float(token.group(4))
                except ValueError:
                    advance = 0.0
                if advance > 10 and line and line[-1] != " ":
                    line.append(" ")
                continue
            if token.group(1):
                line.append(_decode_hex_text(token.group(1).decode("ascii", "ignore")))
            elif token.group(2):
                line.append(_decode_literal_text(token.group(2)))
            elif token.group(3):
                for item in re.finditer(rb"<([0-9A-Fa-f]+)>|\((.*?)\)", token.group(3), re.S):
                    if item.group(1):
                        line.append(_decode_hex_text(item.group(1).decode("ascii", "ignore")))
                    elif item.group(2):
                        line.append(_decode_literal_text(item.group(2)))
        text = "".join(line).strip()
        if text:
            parts.append(text)
    return "\n".join(parts)


def _decode_hex_text(value: str) -> str:
    chars: list[str] = []
    for i in range(0, len(value), 4):
        code = value[i : i + 4]
        if len(code) != 4:
            continue
        try:
            point = int(code, 16)
        except ValueError:
            continue
        if point == 3:
            chars.append(" ")
        else:
            # Chromium subset fonts in the supplied filing encode printable
            # characters with a stable -29 offset, including digits and common
            # punctuation stored below ASCII's printable range.
            shifted = point + 29
            if 0x20 <= shifted <= 0x7E:
                chars.append(chr(shifted))
            elif 0x20 <= point <= 0x7E:
                chars.append(chr(point))
            elif 0x2010 <= point <= 0x203A:
                chars.append(chr(point))
    return "".join(chars)


def _decode_literal_text(value: bytes) -> str:
    text = value.decode("latin-1", "ignore")
    text = text.replace(r"\(", "(").replace(r"\)", ")").replace("\\\\", "\\")
    return text


def _clean_html(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
    raw = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", raw)
    raw = re.sub(r"<[^>]+>", " ", raw)
    return _normalize_text(html.unescape(raw))


def _normalize_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
