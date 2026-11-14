#!/usr/bin/env python3
"""Local development server for the file-browser HTTP contract."""
import json
import mimetypes
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FILES = ROOT / "examples/files"
CONFIG = json.loads((ROOT / "examples/config.json").read_text())


class Preview(SimpleHTTPRequestHandler):
    def reply(self, data, content_type, status=200, attachment=False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Vary", "Accept, Sec-Fetch-Dest")
        if attachment:
            self.send_header("Content-Disposition", "attachment")
        self.end_headers()
        self.wfile.write(data)

    def page(self, name, status=200):
        self.reply((ROOT / "public" / name).read_bytes(), "text/html; charset=utf-8", status)

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query, keep_blank_values=True)
        path = unquote(url.path)
        if path == "/.fs-viewer/config.js":
            self.reply(("globalThis.FS_BROWSER_CONFIG = " + json.dumps(CONFIG) + ";\n").encode(),
                       "text/javascript")
            return
        if path.startswith("/.fs-viewer/"):
            name = path.removeprefix("/.fs-viewer/")
            asset = ROOT / "public" / name
            if name != Path(name).name or not asset.is_file():
                self.page("404.html", 404)
            else:
                self.reply(asset.read_bytes(), mimetypes.guess_type(name)[0] or "application/octet-stream")
            return
        target = (FILES / path.lstrip("/")).resolve()
        if not target.is_relative_to(FILES.resolve()) or not target.exists():
            self.page("404.html", 404)
            return
        browser = ("text/html" in self.headers.get("Accept", "") and
                   self.headers.get("Sec-Fetch-Dest", "document") == "document")
        if target.is_dir():
            if not url.path.endswith("/"):
                self.send_response(301)
                self.send_header("Location", url.path + "/" + ("?" + url.query if url.query else ""))
                self.end_headers()
            elif (target / "index.html").is_file():
                self.reply((target / "index.html").read_bytes(), "text/html")
            elif "json" in query:
                entries = [dict(name=p.name, type="directory" if p.is_dir() else "file",
                                mtime=datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(),
                                size=p.stat().st_size) for p in sorted(target.iterdir())]
                self.reply(json.dumps(entries).encode(), "application/json")
            elif browser and "raw" not in query and "download" not in query:
                self.page("listing.html")
            else:
                super().do_GET()
            return
        extensions = CONFIG["extensions"]
        names = {name.lower() for name in CONFIG["fileNames"]}
        highlighted = target.suffix.lower().lstrip(".") in extensions or target.name.lower() in names
        if browser and highlighted and "raw" not in query and "download" not in query:
            self.page("index.html")
        else:
            mime = "text/plain; charset=utf-8" if highlighted else mimetypes.guess_type(target.name)[0]
            self.reply(target.read_bytes(), mime or "application/octet-stream", attachment="download" in query)


if __name__ == "__main__":
    print("Preview: http://127.0.0.1:8088", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8088), partial(Preview, directory=str(FILES))).serve_forever()
