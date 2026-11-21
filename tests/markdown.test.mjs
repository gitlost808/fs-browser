import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { readBytes, readLimitedText } from "../src/http.js";
import { languageFor } from "../src/files.js";

const asset = name => fs.readFileSync(new URL(`../dist/${name}`, import.meta.url), "utf8");
function browser(page = "index.html", pathname = "/docs/guide.md") {
  const dom = new JSDOM(asset(page), { url: "https://files.example" + pathname, runScripts: "outside-only" });
  const window = dom.window;
  // jsdom does not implement the native image-preview dialog methods.
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.Blob = Blob;
  window.TextDecoder = TextDecoder;
  window.eval(asset("highlight.js"));
  window.eval(asset("markdown.js"));
  return window;
}
async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail("Timed out waiting for the rendered page");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("Markdown formats headings, tables and fenced code and resolves URLs from the source directory", () => {
  const window = browser();
  try {
    const article = window.document.createElement("article");
    window.FS_BROWSER_MARKDOWN.renderMarkdown(article, `# Hello world

[section](#hello-world) [sibling](other.md) ![photo](images/photo.svg)

| A | B |
| - | - |
| 1 | 2 |

\`\`\`javascript
const answer = 42;
\`\`\`

\`\`\`unknown
<script>alert(1)</script>
\`\`\`
`, window.location.href);
    assert.equal(article.querySelector("h1").id, "md-hello-world");
    assert.equal(article.querySelector("a").getAttribute("href"), "#md-hello-world");
    assert.equal(article.querySelectorAll("a")[1].href, "https://files.example/docs/other.md");
    assert.equal(article.querySelector("img").src, "https://files.example/docs/images/photo.svg");
    assert.ok(article.querySelector("table td"));
    assert.ok(article.querySelector("pre code.hljs span"));
    assert.equal(article.querySelector("code.language-unknown").textContent, "<script>alert(1)</script>\n");
    assert.equal(article.querySelector("code script"), null);
  } finally { window.close(); }
});

test("untrusted Markdown and raw HTML cannot introduce scripts, unsafe URLs, CSS or clobbering IDs", () => {
  const window = browser();
  try {
    const article = window.document.createElement("article");
    window.FS_BROWSER_MARKDOWN.renderMarkdown(article, `
<script>alert(1)</script>
<iframe src="https://evil.example"></iframe>
<svg><g onload="alert(1)"></g></svg><math><mtext>bad</mtext></math>
<style>body { display: none }</style><form id="main"><input name="location"></form>
<img src="images/x.png" onerror="alert(1)" style="position:fixed">
<a href="jav&#x61;script:alert(1)" onclick="alert(1)">bad link</a>
<a href="data:text/html,evil">data</a><img src="data:image/svg+xml,evil">
<a href="file:///etc/passwd">file</a><a href="blob:https://files.example/id">blob</a>
<a id="main" name="location" href="../safe.md">safe</a>

# Repeat
# Repeat
`, window.location.href);
    assert.equal(article.querySelector("script,iframe,svg,math,style,form,input,[style],[onerror],[onclick],[name]"), null);
    for (const link of article.querySelectorAll("a[href]")) assert.equal(new URL(link.href).protocol, "https:");
    for (const image of article.querySelectorAll("img[src]")) assert.equal(new URL(image.src).protocol, "https:");
    assert.deepEqual([...article.querySelectorAll("[id]")].map(node => node.id), ["md-repeat", "md-repeat-1"]);
  } finally { window.close(); }
});

test("shared response reader enforces byte limits and cancels oversized streams", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(40000)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readLimitedText({ body }, 65536), /preview limit/);
  assert.equal(cancelled, true);
  assert.equal(await readLimitedText(new Response("Grüße"), 65536), "Grüße");
  for (const [text, truncated] of [["abcd", false], ["abcde", true]]) {
    const result = await readBytes(new Response(text), 4);
    assert.equal(new TextDecoder().decode(result.bytes), "abcd");
    assert.equal(result.truncated, truncated);
  }
});

test("standalone Markdown renders while raw/download links and truncated source fallback remain available", async () => {
  for (const [pathname, text, rendered] of [
    ["/docs/GUIDE.MD", "# Guide\n\n[Next](next.md)", true],
    ["/docs/guide.markdown", "# Guide", true],
    ["/docs/large.md", "# Guide\n" + "x".repeat(1024 * 1024), false],
  ]) {
    const window = browser("index.html", pathname);
    try {
      window.fetch = async url => {
        assert.equal(url, pathname + "?raw");
        return new Response(text);
      };
      window.eval(asset("viewer.js"));
      await until(() => rendered ? window.document.querySelector("#main h1") : window.document.querySelector("#code code").innerHTML);
      assert.equal(!!window.document.querySelector("#main.markdown-body"), rendered);
      assert.equal(window.document.getElementById("raw").getAttribute("href"), "?raw");
      assert.equal(window.document.getElementById("download").getAttribute("href"), "?download");
      if (!rendered) assert.match(window.document.getElementById("notice").textContent, /first 1 MiB/);
    } finally { window.close(); }
  }
});

test("directory README Markdown uses its own URL and txt READMEs stay plain text", async () => {
  for (const name of ["README.md", "README.markdown", "README", "README.txt"]) {
    const window = browser("listing.html", "/docs/");
    try {
      window.fetch = async url => {
        if (url === "/docs/?json") return new Response(JSON.stringify([
          { name, type: "file", size: 100, mtime: "2026-11-20T12:00:00Z" },
        ]));
        assert.equal(url, name + "?raw");
        return new Response("# Docs\n\n[Next](next.md) ![image](images/x.svg)");
      };
      window.eval(asset("listing.js"));
      await until(() => {
        const notice = window.document.getElementById("notice");
        if (!notice.hidden) assert.fail(notice.textContent);
        return !window.document.getElementById("readme").hidden;
      });
      const markdown = window.document.getElementById("readme-markdown");
      if (name.endsWith(".txt")) {
        assert.equal(markdown.hidden, true);
        assert.match(window.document.getElementById("readme-text").textContent, /^# Docs/);
      } else {
        assert.equal(markdown.querySelector("h1").textContent, "Docs");
        assert.equal(markdown.querySelector("a").href, "https://files.example/docs/next.md");
        assert.equal(markdown.querySelector("img").src, "https://files.example/docs/images/x.svg");
      }
    } finally { window.close(); }
  }
});

test("shared breadcrumbs preserve encoded URLs and tolerate invalid UTF-8 names", async () => {
  const window = browser("listing.html", "/docs%20and%20files/%FF/");
  try {
    window.fetch = async () => new Response("[]");
    window.eval(asset("listing.js"));
    await until(() => !window.document.getElementById("listing").hidden);
    const nav = window.document.getElementById("path");
    assert.equal(nav.firstElementChild.textContent, "files.example");
    assert.equal(nav.querySelectorAll("a")[1].getAttribute("href"), "/docs%20and%20files/");
    assert.equal(nav.querySelectorAll("a")[1].textContent, "docs and files");
    assert.equal(nav.lastElementChild.textContent, "%FF");
    assert.equal(nav.lastElementChild.getAttribute("aria-current"), "page");
  } finally { window.close(); }
});

test("file viewer breadcrumbs link home and to every parent directory", () => {
  const window = browser("index.html", "/docs%20and%20files/sub/guide.md");
  try {
    window.fetch = async () => new Response("# Guide");
    window.eval(asset("viewer.js"));
    const nav = window.document.getElementById("path");
    assert.deepEqual([...nav.querySelectorAll("a")].map(a => [a.textContent, a.getAttribute("href")]), [
      ["files.example", "/"],
      ["docs and files", "/docs%20and%20files/"],
      ["sub", "/docs%20and%20files/sub/"],
    ]);
    assert.equal(nav.lastElementChild.textContent, "guide.md");
    assert.equal(nav.lastElementChild.getAttribute("aria-current"), "page");
  } finally { window.close(); }
});

test("404 shares breadcrumbs and skips protected or malformed ancestor listings", async () => {
  for (const failure of ["protected", "malformed"]) {
    const window = browser("404.html", "/docs/privat/README.md");
    const requests = [];
    try {
      window.fetch = async (url, options) => {
        requests.push(url);
        assert.equal(options.redirect, "error");
        if (url === "/docs/privat/?json") {
          if (failure === "protected") throw new Error("sign-in redirect");
          return new Response('{"error":"not a listing"}');
        }
        assert.equal(url, "/docs/?json");
        return new Response(JSON.stringify([{ name: "private", type: "directory" }]));
      };
      window.eval(asset("not-found.js"));
      await until(() => !window.document.getElementById("suggestions").hidden);
      assert.deepEqual(requests, ["/docs/privat/?json", "/docs/?json"]);
      assert.equal(window.document.getElementById("nearest").getAttribute("href"), "/docs/");
      assert.equal(window.document.querySelector("#suggestion-list a").getAttribute("href"), "/docs/private/");
      assert.equal(window.document.querySelector("#path [aria-current]").textContent, "README.md");
      assert.match(window.document.getElementById("nearest-note").textContent, /docs\/privat/);
      for (const use of window.document.querySelectorAll("use[href]")) {
        assert.ok(window.document.getElementById(use.getAttribute("href").slice(1)));
      }
    } finally { window.close(); }
  }
});

test("the frontend and release manifest use identical case-insensitive file-type mappings", () => {
  const manifest = JSON.parse(asset("contract.json"));
  for (const [extension, selection] of Object.entries(manifest.extensions)) {
    assert.deepEqual(languageFor("example." + extension.toUpperCase()), selection);
  }
  for (const [name, selection] of Object.entries(manifest.fileNames)) {
    assert.deepEqual(languageFor(name.toLowerCase()), selection);
    assert.deepEqual(languageFor(name.toUpperCase()), selection);
  }
});
