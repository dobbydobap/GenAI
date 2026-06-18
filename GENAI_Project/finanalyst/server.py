"""Standard-library web server for the Financial Document Analyst."""

from __future__ import annotations

import json
import mimetypes
import shutil
import sys
import uuid
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from finanalyst.analyzer import analyze_batch, analyze_document
from finanalyst.config import load_env_file

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
UPLOADS = ROOT / "data" / "uploads"
SAMPLE = ROOT / "0000936468-21-000013.pdf"


class AnalystHandler(BaseHTTPRequestHandler):
    server_version = "FinAnalyst/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            return self._send_file(STATIC / "index.html")
        if parsed.path == "/api/sample":
            return self._send_json(analyze_document(SAMPLE))
        if parsed.path == "/api/health":
            return self._send_json({"status": "ok"})
        if parsed.path.startswith("/static/"):
            return self._send_file(STATIC / parsed.path.removeprefix("/static/"))
        self.send_error(404, "Not found")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/analyze":
            files = self._receive_files()
            if not files:
                return self._send_json({"error": "Upload at least one PDF or transcript."}, status=400)
            prior = None
            if len(files) == 1:
                result = analyze_document(files[0])
            else:
                result = analyze_batch(files)
                for document in result["documents"]:
                    if prior:
                        refreshed = analyze_document(UPLOADS / document["filename"], prior)
                        document.update(refreshed)
                    prior = document
            return self._send_json(result)
        self.send_error(404, "Not found")

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    def _receive_files(self) -> list[Path]:
        UPLOADS.mkdir(parents=True, exist_ok=True)
        content_type = self.headers.get("content-type", "")
        if not content_type.startswith("multipart/form-data"):
            return []
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        header_blob = (
            f"Content-Type: {content_type}\r\n"
            f"Content-Length: {length}\r\n"
            "MIME-Version: 1.0\r\n\r\n"
        ).encode()
        message = BytesParser(policy=policy.default).parsebytes(header_blob + body)
        saved = []
        for item in message.iter_parts():
            if item.get_param("name", header="content-disposition") != "documents":
                continue
            filename = item.get_filename()
            if not filename:
                continue
            name = Path(filename).name
            target = UPLOADS / f"{uuid.uuid4().hex[:10]}-{name}"
            with target.open("wb") as handle:
                payload = item.get_payload(decode=True) or b""
                handle.write(payload)
            saved.append(target)
        return saved

    def _send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            return self.send_error(404, "Not found")
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    load_env_file()
    query = parse_qs(urlparse("?" + " ".join(sys.argv[1:])).query)
    port = int(query.get("port", ["8000"])[0]) if query else 8000
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    server = ThreadingHTTPServer(("127.0.0.1", port), AnalystHandler)
    print(f"Financial Document Analyst running at http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
