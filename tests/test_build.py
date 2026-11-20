import json
import re
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BuildTests(unittest.TestCase):
    def test_release_contains_pages_and_owns_file_type_mappings(self):
        with tempfile.TemporaryDirectory() as staging:
            subprocess.run(["bash", str(ROOT / "deploy.sh"), staging], check=True)
            output = Path(staging)
            for name in ("index.html", "listing.html", "404.html"):
                self.assertTrue((output / name).stat().st_size)
                self.assertNotIn("{{", (output / name).read_text())
            # Pages are served at arbitrary file paths; assets must resolve
            # through the reserved prefix without consumer-provided scripts.
            for page in output.glob("*.html"):
                for name in re.findall(r'(?:src|href)="/\.fs-viewer/([^"?]+)"', page.read_text()):
                    self.assertTrue((output / name).is_file(), name)
                self.assertNotIn("config.js", page.read_text())
            for name in ("highlight.js", "marked", "dompurify"):
                self.assertTrue((output / f"{name}.LICENSE").stat().st_size)
            self.assertFalse(any(path.is_symlink() for path in output.rglob("*")))
            self.assertFalse((output / "config.js").exists())
            contract = json.loads((output / "contract.json").read_text())
            self.assertEqual(contract["version"], 2)
            config = json.loads((ROOT / "src/file-types.json").read_text())
            self.assertEqual(contract["extensions"], config["extensions"])
            self.assertEqual(contract["fileNames"], config["fileNames"])
            for value in [*config["extensions"].values(), *config["fileNames"].values()]:
                for language in value if isinstance(value, list) else [value]:
                    self.assertIn(language, contract["languages"])
            # A build cannot silently overwrite an existing release tree.
            result = subprocess.run(["bash", str(ROOT / "deploy.sh"), staging], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
