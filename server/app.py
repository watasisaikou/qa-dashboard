#!/usr/bin/env python3
"""qa-dashboard のローカルバックエンド。stdlib のみ・依存ゼロ。★ 127.0.0.1 バインド限定。

フロントの「解析」フォームから URL を受け取り、qa.py をサブプロセスで走らせて
JSON レポートを返す。ライブストリーミングは無し（Phase 2 以降）— 1 回のリクエスト
で完走を待って結果を返すだけ。

  python app.py                # 8000 番、`../dist` があれば /qa-dashboard/ で配信
  python app.py --port 8001
  QA_PORT=8001 python app.py

Routes:
  GET  /api/health                       -> {"ok": true}
  POST /api/analyze  {url, widths?, vlm?} -> qa.py の report.json をそのまま返す
                                              （nav_screenshot は /api/screenshots/... に書き換え）
  GET  /api/screenshots/<runId>/<name>   -> その run の tmpdir から PNG を配信
  GET  /qa-dashboard/*                   -> ../dist を配信（build 済みの場合のみ）
  GET  /                                 -> /qa-dashboard/ へ 302

★ 解析は同時 1 本まで（threading.Lock）。qa.py は HIGH 検出時に exit 1 を返すが、
  それは「欠陥が見つかった」という意味で成功。report.json が書けていれば成功として扱う。
"""
import argparse
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

QA_PY = os.environ.get("QA_PY") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "qa.py"
)
DIST_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
)
DEFAULT_WIDTHS = "360,390,768,1280"
ANALYZE_TIMEOUT_SEC = 180

# ブラウザが module script を厳密な MIME で判定することがあるため明示しておく。
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("image/svg+xml", ".svg")

ANALYSIS_LOCK = threading.Lock()
RUNS: dict[str, str] = {}  # runId -> tmpdir


class Handler(BaseHTTPRequestHandler):
    server_version = "qa-dashboard-backend/1.0"

    # ---------- helpers ----------

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status: int, obj: object, cors: bool = True) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if cors:
            self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, status: int, data: bytes, content_type: str, cors: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if cors:
            self._cors_headers()
        self.end_headers()
        self.wfile.write(data)

    # ---------- CORS preflight ----------

    def do_OPTIONS(self) -> None:
        if urlparse(self.path).path.startswith("/api/"):
            self.send_response(204)
            self._cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    # ---------- GET ----------

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/qa-dashboard/")
            self.end_headers()
            return

        if path == "/api/health":
            self._send_json(200, {"ok": True})
            return

        if path.startswith("/api/screenshots/"):
            self._serve_screenshot(path)
            return

        if path.startswith("/qa-dashboard/"):
            self._serve_static(path)
            return

        if path.startswith("/api/"):
            self._send_json(404, {"error": "not found"})
        else:
            self._send_bytes(404, b"not found", "text/plain")

    def _serve_screenshot(self, path: str) -> None:
        rest = path[len("/api/screenshots/"):]
        parts = rest.split("/")
        if len(parts) != 2 or not parts[0] or not parts[1]:
            self._send_json(404, {"error": "not found"})
            return
        run_id, name = parts
        if ".." in run_id or ".." in name or "/" in name or "\\" in name:
            self._send_json(400, {"error": "invalid path"})
            return
        tmpdir = RUNS.get(run_id)
        if not tmpdir:
            self._send_json(404, {"error": "unknown run"})
            return
        full = os.path.join(tmpdir, name)
        if not os.path.isfile(full):
            self._send_json(404, {"error": "not found"})
            return
        with open(full, "rb") as f:
            data = f.read()
        self._send_bytes(200, data, "image/png", cors=True)

    def _serve_static(self, path: str) -> None:
        if not os.path.isdir(DIST_DIR):
            self._send_bytes(404, b"dist/ not built - run `npm run build` first", "text/plain")
            return
        rel = path[len("/qa-dashboard/"):] or "index.html"
        if ".." in rel.split("/"):
            self._send_bytes(400, b"bad path", "text/plain")
            return
        full = os.path.normpath(os.path.join(DIST_DIR, rel))
        if os.path.commonpath([full, DIST_DIR]) != DIST_DIR:
            self._send_bytes(403, b"forbidden", "text/plain")
            return
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            full = os.path.join(DIST_DIR, "index.html")  # single-page app fallback
        if not os.path.isfile(full):
            self._send_bytes(404, b"not found", "text/plain")
            return
        ctype, _ = mimetypes.guess_type(full)
        with open(full, "rb") as f:
            data = f.read()
        self._send_bytes(200, data, ctype or "application/octet-stream")

    # ---------- POST ----------

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/analyze":
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b"{}"
            self._handle_analyze(body)
            return
        self._send_json(404, {"error": "not found"})

    def _handle_analyze(self, body: bytes) -> None:
        try:
            data = json.loads(body.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "invalid JSON body"})
            return
        if not isinstance(data, dict):
            self._send_json(400, {"error": "invalid JSON body"})
            return

        url = data.get("url")
        if not isinstance(url, str) or not (url.startswith("http://") or url.startswith("https://")):
            self._send_json(400, {"error": "url must start with http:// or https://"})
            return

        widths = data.get("widths")
        if not isinstance(widths, str) or not widths.strip():
            widths = DEFAULT_WIDTHS

        vlm = bool(data.get("vlm", False))

        if not ANALYSIS_LOCK.acquire(blocking=False):
            self._send_json(409, {"error": "analysis in progress"})
            return
        try:
            run_id = uuid.uuid4().hex[:12]
            tmpdir = tempfile.mkdtemp(prefix="qa_run_")
            RUNS[run_id] = tmpdir
            report_path = os.path.join(tmpdir, "report.json")
            cmd = [sys.executable, QA_PY, url, "--widths", widths,
                   "--json", report_path, "--out", tmpdir]
            if vlm:
                cmd.append("--vlm")

            try:
                proc = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=ANALYZE_TIMEOUT_SEC
                )
            except subprocess.TimeoutExpired:
                self._send_json(504, {
                    "error": "analysis timed out (the site may block headless browsers or be slow)"
                })
                return

            # qa.py exits 1 when HIGH findings exist -- that's a successful run for us.
            # Only a missing report.json means the run actually failed.
            if not os.path.isfile(report_path):
                tail = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()[-400:]
                self._send_json(502, {"error": tail or "qa.py produced no report and no output"})
                return

            with open(report_path, "r", encoding="utf-8") as f:
                report = json.load(f)

            for page in report.get("pages", []):
                for wd in page.get("widths", {}).values():
                    fn = wd.get("nav_screenshot")
                    if fn:
                        wd["nav_screenshot"] = "/api/screenshots/%s/%s" % (run_id, fn)

            self._send_json(200, report)
        finally:
            ANALYSIS_LOCK.release()

    # keep default access logging (stderr) -- useful during local dev


def main() -> None:
    ap = argparse.ArgumentParser(description="qa-dashboard local backend")
    ap.add_argument("--port", type=int, default=int(os.environ.get("QA_PORT", "8000")))
    args = ap.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    base_url = "http://127.0.0.1:%d/" % args.port
    print("qa-dashboard backend listening on %s (127.0.0.1 only)" % base_url)
    if os.path.isdir(DIST_DIR):
        print("open: http://127.0.0.1:%d/qa-dashboard/" % args.port)
    else:
        print("dist/ not built yet -- run `npm run build`, or use `npm run dev` (port 5173) "
              "which proxies /api to this backend.")
    print("qa.py needs Chrome (or Edge) installed. For --vlm, ollama must be running "
          "locally with the gemma4:e4b-it-qat model pulled.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
