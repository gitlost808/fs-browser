import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import hljs from "../src/highlighter.js";

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
  entryPoints: {
    viewer: "src/viewer.js",
    markdown: "src/markdown-browser.js",
    listing: "src/listing.js",
    "not-found": "src/not-found.js",
    highlight: "src/highlight-browser.js",
    "github.min": "node_modules/highlight.js/styles/github.css",
    "github-dark.min": "node_modules/highlight.js/styles/github-dark.css",
  },
  outdir: output,
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  legalComments: "linked",
});
fs.cpSync(path.join(root, "public"), output, { recursive: true });
fs.copyFileSync(path.join(root, "node_modules/highlight.js/LICENSE"), path.join(output, "highlight.js.LICENSE"));
for (const name of ["marked", "dompurify"]) {
  fs.copyFileSync(path.join(root, "node_modules", name, "LICENSE"), path.join(output, `${name}.LICENSE`));
}
fs.writeFileSync(path.join(output, "contract.json"), JSON.stringify({
  version: 1,
  languages: hljs.listLanguages().sort(),
}) + "\n");
