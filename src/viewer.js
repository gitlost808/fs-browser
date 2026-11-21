import { decode, languageFor } from "./files.js";
import { showNotice, renderBreadcrumbs } from "./dom.js";
import { readBytes } from "./http.js";

// Only this much is read, so a large or mislabeled file never downloads in
// full or freezes the tab while highlighting.
const READ_LIMIT = 1024 * 1024;

const path = location.pathname;
const name = decode(path.split("/").pop());
const rawUrl = path + "?raw";
const downloadUrl = path + "?download";
document.title = name + " · " + location.host;
renderBreadcrumbs(document.getElementById("path"), path, location.host);

async function readRaw() {
  const response = await fetch(rawUrl);
  if (!response.ok) throw new Error(response.status + " " + response.statusText);
  return readBytes(response, READ_LIMIT);
}

// Strict UTF-8 first; anything else is most likely a legacy Western
// encoding. A truncated read may end inside a character, which `stream`
// drops instead of showing it as a replacement character.
function decodeText(bytes, truncated) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated });
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function highlight(text, truncated) {
  // A cut-off prefix can end inside a construct; keep it plain.
  if (truncated) {
    return hljs.highlight(text, { language: "plaintext" });
  }
  const language = languageFor(name);
  // A list leaves the choice among those candidates to highlight.js.
  if (Array.isArray(language)) {
    return hljs.highlightAuto(text, language);
  }
  // Without ignoreIllegals, one unexpected token leaves the whole file plain.
  return hljs.highlight(text, {
    language: hljs.getLanguage(language) ? language : "plaintext",
    ignoreIllegals: true,
  });
}

function render(text, truncated) {
  if (!truncated && globalThis.FS_BROWSER_MARKDOWN.isMarkdown(name)) {
    const article = document.getElementById("markdown");
    globalThis.FS_BROWSER_MARKDOWN.renderMarkdown(article, text, location.href);
    document.getElementById("main").remove();
    article.id = "main";
    article.hidden = false;
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    return;
  }
  const lineCount = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const lines = document.getElementById("lines");
  for (let number = 1; number <= Math.max(lineCount, 1); number++) {
    const anchor = document.createElement("a");
    anchor.id = "L" + number;
    anchor.textContent = number;
    anchor.href = "#L" + number;
    lines.append(anchor, "\n");
  }
  const code = document.querySelector("#code code");
  // highlight.js escapes the source, so its HTML output is safe to insert.
  code.innerHTML = highlight(text, truncated).value;
  code.classList.add("hljs");
  if (location.hash) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
}

readRaw()
  .then(({ bytes, truncated }) => {
    // Text files practically never contain NUL bytes; binary formats do.
    if (bytes.subarray(0, 8192).includes(0)) {
      document.getElementById("main").remove();
      showNotice("This looks like a binary file. Starting download…");
      location.replace(downloadUrl);
      return;
    }
    if (truncated) {
      showNotice("Showing the first 1 MiB; use raw or download for the whole file.");
    }
    render(decodeText(bytes, truncated), truncated);
  })
  .catch(error => {
    document.getElementById("main").remove();
    showNotice("Could not load " + name + ": " + error.message);
  });
