import { decode } from "./files.js";

export function showNotice(content) {
  const notice = document.getElementById("notice");
  notice.replaceChildren(...(Array.isArray(content) ? content : [content]));
  notice.hidden = false;
}

export function renderBreadcrumbs(nav, path, host) {
  const segments = path.split("/").filter(Boolean);
  const root = document.createElement("a");
  root.href = "/";
  root.textContent = host;
  nav.replaceChildren(root);
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    const item = document.createElement(last ? "span" : "a");
    item.textContent = decode(segment);
    if (last) item.setAttribute("aria-current", "page");
    else item.href = "/" + segments.slice(0, index + 1).join("/") + "/";
    nav.append(item);
  });
}
