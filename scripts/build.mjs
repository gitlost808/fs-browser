import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import hljs from "../src/highlighter.js";
import { buildPages } from "./pages.mjs";
import fileTypes from "../src/file-types.json" with { type: "json" };

const contract = { version: 2, languages: hljs.listLanguages().sort(), ...fileTypes };
for (const [field, mapping] of Object.entries(fileTypes)) {
  const pattern = field === "extensions" ? /^[a-z0-9]+$/ : /^[A-Za-z0-9_.-]+$/;
  const seen = new Set();
  for (const [name, value] of Object.entries(mapping)) {
    const languages = Array.isArray(value) ? value : [value];
    if (!pattern.test(name) || name.trim() !== name || [".", ".."].includes(name) || seen.has(name.toLowerCase())) {
      throw new Error(`Invalid or duplicate ${field} key: ${name}`);
    }
    seen.add(name.toLowerCase());
    if (!languages.length || languages.some(language => !contract.languages.includes(language))) {
      throw new Error(`Unsupported highlighting language for ${name}`);
    }
  }
}

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "dist");
if (process.argv[2]) {
  // Publisher staging must already exist and be empty; never clear it ourselves.
  if (!fs.statSync(output).isDirectory() || fs.readdirSync(output).length) {
    throw new Error("Usage: node scripts/build.mjs EMPTY_STAGING_DIRECTORY");
  }
} else {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output);
}

await build({
  absWorkingDir: root,
  entryPoints: [
    ...["viewer", "listing", "not-found"].flatMap(name => [
      { in: `src/${name}.js`, out: name },
      { in: `src/styles/${name}.css`, out: name },
    ]),
    { in: "src/styles/common.css", out: "common" },
    { in: "src/styles/document.css", out: "document" },
    { in: "src/markdown-browser.js", out: "markdown" },
    { in: "src/highlight-browser.js", out: "highlight" },
  ],
  outdir: output,
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  legalComments: "linked",
});
buildPages(output);
fs.copyFileSync(path.join(root, "node_modules/highlight.js/LICENSE"), path.join(output, "highlight.js.LICENSE"));
for (const name of ["marked", "dompurify"]) {
  fs.copyFileSync(path.join(root, "node_modules", name, "LICENSE"), path.join(output, `${name}.LICENSE`));
}
fs.writeFileSync(path.join(output, "contract.json"), JSON.stringify(contract) + "\n");
