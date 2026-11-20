import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const config = JSON.parse(fs.readFileSync(new URL("../examples/config.json", import.meta.url)));
const asset = name => fs.readFileSync(new URL(`../dist/${name}`, import.meta.url), "utf8");
function browser(page = "index.html", pathname = "/docs/guide.md") {
  const dom = new JSDOM(asset(page), { url: "https://files.example" + pathname, runScripts: "outside-only" });
  const window = dom.window;
  window.FS_BROWSER_CONFIG = config;
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

test("README streaming enforces the byte limit even if autoindex size was stale", async () => {
  const window = browser();
  try {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(40000)); },
      cancel() { cancelled = true; },
    });
    await assert.rejects(window.FS_BROWSER_MARKDOWN.readLimitedText({ body }, 65536), /64 KiB/);
    assert.equal(cancelled, true);
    const text = await window.FS_BROWSER_MARKDOWN.readLimitedText(new Response("Grüße"), 65536);
    assert.equal(text, "Grüße");
  } finally { window.close(); }
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
