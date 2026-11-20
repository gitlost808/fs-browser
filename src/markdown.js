import { Marked } from "marked";
import DOMPurify from "dompurify";

const parser = new Marked({ gfm: true, async: false });
const markdownName = /(?:\.(?:md|markdown)$|^readme$)/i;

export function isMarkdown(name) {
  return markdownName.test(name);
}

export function renderMarkdown(target, text, sourceURL) {
  // No styles, forms, embedded documents, SVG, or named elements from files.
  const fragment = DOMPurify.sanitize(parser.parse(text), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ["p", "h1", "h2", "h3", "h4", "h5", "h6", "a", "img",
      "pre", "code", "span", "em", "strong", "del", "s", "ul", "ol", "li",
      "blockquote", "hr", "br", "table", "thead", "tbody", "tr", "th", "td",
      "details", "summary", "sup", "sub", "kbd"],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "start", "align"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const base = new URL(sourceURL, location.href);
  for (const node of fragment.querySelectorAll("a[href], img[src]")) {
    const attribute = node.tagName === "A" ? "href" : "src";
    const value = node.getAttribute(attribute);
    // README fragments belong to this page, rather than opening the file.
    if (attribute === "href" && value.startsWith("#")) {
      node.setAttribute("href", "#md-" + value.slice(1));
      continue;
    }
    try {
      const url = new URL(value, base);
      const schemes = attribute === "href" ? ["http:", "https:", "mailto:"] : ["http:", "https:"];
      if (!schemes.includes(url.protocol)) throw new Error("Unsafe URL");
      node.setAttribute(attribute, url.href);
    } catch {
      node.removeAttribute(attribute);
    }
  }
  const slugs = new Set();
  for (const heading of fragment.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const slug = heading.textContent.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-");
    let id = "md-" + slug;
    for (let count = 1; slugs.has(id); count++) id = "md-" + slug + "-" + count;
    slugs.add(id);
    heading.id = id;
  }
  for (const code of fragment.querySelectorAll("pre code")) {
    const language = [...code.classList].find(name => name.startsWith("language-"))?.slice(9);
    // Unknown languages stay escaped text; no expensive auto-detection.
    if (language && globalThis.hljs?.getLanguage(language)) {
      code.innerHTML = globalThis.hljs.highlight(code.textContent, { language, ignoreIllegals: true }).value;
      code.classList.add("hljs");
    }
  }
  target.replaceChildren(fragment);
  target.classList.add("markdown-body");
}
