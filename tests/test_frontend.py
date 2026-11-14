"""Frontend regressions, independent of infrastructure inventory and Ansible."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "public"
CONFIG = json.loads((ROOT / "examples/config.json").read_text())


class FsBrowserTests(unittest.TestCase):
    def render(self, path):
        return path.read_text()

    @unittest.skipUnless(shutil.which("node"), "Node.js required to execute the viewer")
    def test_viewer_downloads_binary_source_and_keeps_text_inline(self):
        page = self.render(VIEWER / "index.html")
        source = re.search(r"<script>([\s\S]*?)</script>", page).group(1)
        harness = r'''
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = SOURCE;

async function view(fileName, bytes) {
  const downloads = [];
  const elements = new Map();
  function element() {
    return {
      innerHTML: "", removed: false, classList: { add() {} },
      remove() { this.removed = true; }, append() {},
    };
  }
  const code = element();
  const context = vm.createContext({
    Blob, TextDecoder, FS_BROWSER_CONFIG: CONFIG_VALUE,
    location: { pathname: "/" + fileName, hash: "", replace(url) { downloads.push(url); } },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      querySelector(selector) { assert.equal(selector, "#code code"); return code; },
      createElement() { return element(); },
    },
    async fetch(url) {
      assert.equal(url, "/" + fileName + "?raw");
      return { ok: true, body: new Blob([bytes]).stream() };
    },
  });
  vm.runInContext(fs.readFileSync(process.argv[2], "utf8"), context);
  await vm.runInContext(source, context);
  return { downloads, elements, code };
}

(async () => {
  const binary = await view("video.ts", new Uint8Array([0x47, 0x40, 0, 0x10]));
  assert.deepEqual(binary.downloads, ["/video.ts?download"]);
  assert.equal(binary.elements.get("main").removed, true);
  assert.equal(binary.code.innerHTML, "");

  for (const fileName of ["sample.ts", "SAMPLE.TS", "types.d.ts"]) {
    const text = await view(fileName, 'interface User { id: number; }\nconst s = "<script>";\n');
    assert.deepEqual(text.downloads, []);
    assert.notEqual(text.elements.get("main")?.removed, true);
    assert.match(text.code.innerHTML, /class="hljs-/);
    assert.ok(!text.code.innerHTML.includes("<script>"));
  }
  const legacy = await view("legacy.ts", new Uint8Array([0xe4, 0x0a]));
  assert.deepEqual(legacy.downloads, []);
})().catch(error => { console.error(error); process.exitCode = 1; });
'''
        result = subprocess.run(
            ["node", "-", str(VIEWER / "highlight.min.js")],
            input=harness.replace("SOURCE", json.dumps(source)).replace("CONFIG_VALUE", json.dumps(CONFIG)),
            capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


    @unittest.skipUnless(shutil.which("node"), "Node.js required to execute the listing")
    def test_image_preview_browser_history(self):
        page = self.render(VIEWER / "listing.html")
        source = re.search(r"<script>([\s\S]*?)</script>", page).group(1)
        result = subprocess.run(
            ["node", str(ROOT / "tests/fs-viewer-history.cjs")],
            input=source, capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


    def test_listing_previews_only_image_files(self):
        rendered = self.render(VIEWER / "listing.html")
        previewable = json.loads(re.search(r"const PREVIEWABLE = (\[.*\]);", rendered).group(1))
        images = json.loads(re.search(r"^\s*image: (\[.*\]),$", rendered, re.M).group(1))
        self.assertTrue(previewable)
        self.assertLessEqual(set(previewable), set(images))
