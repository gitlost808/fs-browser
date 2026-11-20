"""Exercise HTTP request handling without opening a listening socket."""
import importlib.util
import io
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("preview", ROOT / "scripts/preview.py")
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class Request:
    def __init__(self, path):
        self.input = io.BytesIO((f"GET {path} HTTP/1.0\r\nAccept: text/html\r\n"
                                "Sec-Fetch-Dest: document\r\n\r\n").encode())
        self.output = bytearray()

    def makefile(self, mode, buffering):
        return self.input

    def sendall(self, data):
        self.output.extend(data)


class PreviewTests(unittest.TestCase):
    def request(self, path):
        request = Request(path)
        preview.Preview(request, ("127.0.0.1", 1234), None, directory=str(preview.FILES))
        head, body = bytes(request.output).split(b"\r\n\r\n", 1)
        return head.decode(), body

    def test_browser_and_raw_http_contract(self):
        self.assertIn(b'id="listing"', self.request("/")[1])
        self.assertIn(b'id="code"', self.request("/sample.py")[1])
        self.assertIn(b"def greeting", self.request("/sample.py?raw")[1])
        self.assertIn("Content-Disposition: attachment", self.request("/sample.py?download")[0])
        self.assertIn("Content-Type: image/svg+xml", self.request("/images/blue.svg")[0])
        self.assertTrue(any(entry["name"] == "sample.py" for entry in json.loads(self.request("/?json")[1])))
        self.assertIn("404", self.request("/.fs-viewer/config.js")[0])
        contract = json.loads(self.request("/.fs-viewer/contract.json")[1])
        self.assertEqual(contract["version"], 2)
        self.assertEqual(contract["extensions"]["py"], "python")
        head, body = self.request("/missing-file.py")
        self.assertIn("404", head)
        self.assertIn(b"Not found", body)
        self.assertIn("404", self.request("/../README.md")[0])
        self.assertIn("404", self.request("/.fs-viewer/../README.md")[0])
