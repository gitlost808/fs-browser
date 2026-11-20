import { decode, extensionOf, languageFor } from "./files.js";
import { showNotice, renderBreadcrumbs } from "./dom.js";
import { fetchListing, readLimitedText } from "./http.js";

// Icons only; nginx serves these files like any other.
const KINDS = {
  image: ["avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg", "webp"],
  video: ["avi", "m4v", "mkv", "mov", "mp4", "ts", "webm"],
  audio: ["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"],
  archive: ["7z", "bz2", "gz", "iso", "rar", "tar", "tgz", "xz", "zip", "zst"],
};

// Formats every current browser shows in an <img>; these open in the
// in-page preview, and the others, such as HEIC, keep opening directly.
const PREVIEWABLE = ["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"];

// A README up to this size is shown below the listing.
const README = /^readme(\.(md|markdown|txt))?$/i;
const README_LIMIT = 64 * 1024;

const SORT_STORAGE_KEY = "fs-listing-sort";
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const AGE_UNITS = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];

const list = document.getElementById("entries");
const filter = document.getElementById("filter");
const preview = document.getElementById("preview");
const previewStage = document.getElementById("preview-stage");
const path = location.pathname;
let entries = [];
let upRow = null;
let sort = { key: "name", order: "asc" };
// The images the preview steps through, and the one it shows.
let gallery = [];
let galleryIndex = 0;
let previewClosing = false;

function plainListingLink(text) {
  const link = document.createElement("a");
  link.href = "?raw";
  link.textContent = text;
  return link;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return (value < 10 ? value.toFixed(1) : Math.round(value)) + " " + units[unit];
}

function formatAge(time) {
  const seconds = (time - Date.now()) / 1000;
  for (const [unit, length] of AGE_UNITS) {
    if (Math.abs(seconds) >= length) return relative.format(Math.round(seconds / length), unit);
  }
  return "just now";
}

function kindOf(entry) {
  if (entry.isDirectory) return "folder";
  const extension = extensionOf(entry.name);
  if (languageFor(entry.name) !== undefined) {
    return "code";
  }
  return Object.keys(KINDS).find(kind => KINDS[kind].includes(extension)) ?? "file";
}

function createRow(kind, name, href) {
  const row = document.getElementById("row").content.firstElementChild.cloneNode(true);
  row.dataset.kind = kind;
  row.querySelector(".icon use").setAttribute("href", "#i-" + kind);
  const link = row.querySelector(".name");
  link.textContent = name;
  link.href = href;
  return row;
}

function createEntryRow(entry) {
  const row = createRow(kindOf(entry), entry.name, entry.href);
  if (!entry.isDirectory) {
    row.querySelector(".size").textContent = formatSize(entry.size);
  }
  const time = row.querySelector(".mtime");
  if (!Number.isNaN(entry.mtime)) {
    const date = new Date(entry.mtime);
    time.dateTime = date.toISOString();
    time.title = date.toLocaleString();
    time.textContent = formatAge(entry.mtime);
  }
  const copy = row.querySelector(".copy");
  copy.setAttribute("aria-label", "Copy link to " + entry.name);
  copy.title = "Copy link";
  return row;
}

function compare(a, b) {
  // Folders stay first in either order.
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  const direction = sort.order === "asc" ? 1 : -1;
  let result = 0;
  if (sort.key === "size" && !a.isDirectory) result = a.size - b.size;
  if (sort.key === "mtime") result = a.mtime - b.mtime;
  if (result !== 0) return result * direction;
  // Ties, and folders by size, stay alphabetical.
  return collator.compare(a.name, b.name) * (sort.key === "name" ? direction : 1);
}

function applySort() {
  for (const button of document.querySelectorAll(".sort")) {
    const active = button.dataset.key === sort.key;
    button.setAttribute("aria-pressed", active);
    if (active) {
      button.dataset.order = sort.order;
    } else {
      delete button.dataset.order;
    }
  }
  const rows = [...entries].sort(compare).map(entry => entry.row);
  list.replaceChildren(...(upRow ? [upRow] : []), ...rows);
}

function applyFilter() {
  const query = filter.value.trim().toLowerCase();
  let shown = 0;
  for (const entry of entries) {
    entry.row.hidden = !entry.name.toLowerCase().includes(query);
    if (!entry.row.hidden) shown++;
  }
  const empty = document.getElementById("empty");
  empty.hidden = shown > 0;
  empty.textContent = entries.length ? "No names match “" + filter.value.trim() + "”." : "This folder is empty.";
  document.getElementById("summary").textContent = query ? shown + " of " + entries.length + " match" : summary();
}

function summary() {
  const folders = entries.filter(entry => entry.isDirectory).length;
  const files = entries.filter(entry => !entry.isDirectory);
  const parts = [];
  if (folders) parts.push(folders + (folders === 1 ? " folder" : " folders"));
  if (files.length) {
    parts.push(files.length + (files.length === 1 ? " file" : " files"));
    parts.push(formatSize(files.reduce((total, entry) => total + entry.size, 0)));
  }
  return parts.join(" · ");
}

function loadSort() {
  try {
    const stored = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY));
    if (["name", "size", "mtime"].includes(stored?.key) && ["asc", "desc"].includes(stored?.order)) {
      sort = stored;
    }
  } catch {
    // Storage may be unavailable; the default order applies.
  }
}

function saveSort() {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // Not remembered, but still applied.
  }
}

async function copyLink(button, href) {
  try {
    await navigator.clipboard.writeText(new URL(href, location.href).href);
  } catch {
    button.title = "Copying failed";
    return;
  }
  const icon = button.querySelector("use");
  button.classList.add("done");
  button.title = "Copied";
  icon.setAttribute("href", "#i-check");
  clearTimeout(button.resetTimer);
  button.resetTimer = setTimeout(() => {
    button.classList.remove("done");
    button.title = "Copy link";
    icon.setAttribute("href", "#i-link");
  }, 1500);
}

async function showReadme() {
  const readme = [...entries].sort(compare).find(entry =>
    !entry.isDirectory && README.test(entry.name) && entry.size <= README_LIMIT);
  if (!readme) return;
  // Files are cached for days, but an edited README must show with the
  // fresh listing; the revalidation is a 304 while it is unchanged.
  const response = await fetch(readme.href + "?raw", { cache: "no-cache" });
  if (!response.ok) return;
  const section = document.getElementById("readme");
  const name = document.getElementById("readme-name");
  name.textContent = readme.name;
  name.href = readme.href;
  const text = await readLimitedText(response, README_LIMIT);
  if (globalThis.FS_BROWSER_MARKDOWN.isMarkdown(readme.name)) {
    const article = document.getElementById("readme-markdown");
    globalThis.FS_BROWSER_MARKDOWN.renderMarkdown(article, text, new URL(readme.href, location.href));
    document.getElementById("readme-text").hidden = true;
    article.hidden = false;
  } else {
    document.getElementById("readme-text").textContent = text;
  }
  section.hidden = false;
}

function showImage(index) {
  galleryIndex = (index + gallery.length) % gallery.length;
  const entry = gallery[galleryIndex];
  const status = document.getElementById("preview-status");
  previewStage.dataset.state = "loading";
  status.textContent = "Loading…";
  // A new element, since an <img> keeps showing its previous image until
  // a new source has loaded; a large one also renders as it arrives.
  const image = new Image();
  image.alt = entry.name;
  image.addEventListener("load", () => {
    if (image.isConnected) previewStage.dataset.state = "loaded";
  });
  image.addEventListener("error", () => {
    if (!image.isConnected) return;
    previewStage.dataset.state = "error";
    status.textContent = "This image could not be shown; open or download it instead.";
  });
  image.src = entry.href;
  stopImage().replaceWith(image);
  document.getElementById("preview-name").textContent = entry.name;
  document.getElementById("preview-count").textContent = gallery.length > 1
    ? (galleryIndex + 1) + " / " + gallery.length + " · " + formatSize(entry.size)
    : formatSize(entry.size);
  document.getElementById("preview-open").href = entry.href;
  document.getElementById("preview-download").href = entry.href + "?download";
  // Browsing images stays within one preview history entry, whose URL
  // names the image shown.
  if (preview.open) {
    history.replaceState({ ...history.state, fsPreview: entry.name }, "", previewHash(entry));
  }
  // Stepping on shows the neighbors from the cache.
  if (gallery.length > 1) {
    for (const step of [1, -1]) {
      new Image().src = gallery[(galleryIndex + step + gallery.length) % gallery.length].href;
    }
  }
}

// Removing the source cancels a download still in progress.
function stopImage() {
  const image = previewStage.querySelector("img");
  image.removeAttribute("src");
  return image;
}

// A preview's URL is the listing's with the image in its fragment, such
// as `/photos/#cat.jpg`, so it can be shared; nginx never sees it.
function previewHash(entry) {
  return "#" + entry.href;
}

// Browsers may leave characters in a typed or pasted fragment unencoded.
function hashedEntry() {
  const hash = location.hash.slice(1);
  if (!hash) return undefined;
  return entries.find(item => item.previewable && (item.href === hash || item.name === decode(hash)));
}

// The preview steps through the images as the listing shows them, in
// its order and with its filter.
function openPreview(entry, remember = true) {
  if (previewClosing) return;
  gallery = [...entries].sort(compare).filter(item =>
    item.previewable && (!item.row.hidden || item === entry));
  for (const button of preview.querySelectorAll(".preview-step")) {
    button.hidden = gallery.length < 2;
  }
  // Keep the listing URL and its filter, sort order and scroll position.
  if (remember) history.pushState({ ...history.state, fsPreview: entry.name }, "", previewHash(entry));
  showImage(gallery.indexOf(entry));
  preview.showModal();
}

function closePreview() {
  if (!preview.open || previewClosing) return;
  stopImage();
  // Explicit dismissal consumes the same entry as the browser Back button.
  if (history.state?.fsPreview) {
    // Keep the listing inert until the asynchronous traversal completes.
    previewClosing = true;
    history.back();
  } else {
    preview.close();
  }
}

// The URL decides whether the preview is open, and on which image.
function restorePreview(initial = false) {
  previewClosing = false;
  const entry = hashedEntry();
  if (!entry) {
    preview.close();
    stopImage();
    return;
  }
  if (!history.state?.fsPreview) {
    if (initial) {
      // A shared link opens over its listing, which Back and closing
      // then return to.
      history.replaceState(history.state, "", location.pathname + location.search);
      openPreview(entry);
      return;
    }
    // An edited fragment added this entry; closing returns past it.
    history.replaceState({ ...history.state, fsPreview: entry.name }, "");
  }
  openPreview(entry, false);
}

window.addEventListener("popstate", () => restorePreview());

renderBreadcrumbs(document.getElementById("path"), path, location.host);
const segments = path.split("/").filter(Boolean);
document.title = segments.length ? decode(segments.at(-1)) + " · " + location.host : location.host;
loadSort();

fetchListing(path)
  .then(data => {
    entries = data.map(item => {
      const isDirectory = item.type === "directory";
      const entry = {
        name: item.name,
        isDirectory,
        href: encodeURIComponent(item.name) + (isDirectory ? "/" : ""),
        size: item.size ?? 0,
        mtime: Date.parse(item.mtime),
      };
      entry.previewable = !isDirectory && PREVIEWABLE.includes(extensionOf(item.name));
      entry.row = createEntryRow(entry);
      return entry;
    });
    if (path !== "/") {
      upRow = createRow("up", "..", "../");
      upRow.querySelector(".meta").remove();
      upRow.querySelector(".copy").remove();
      upRow.querySelector(".name").setAttribute("aria-label", "Parent folder");
    }
    applySort();
    // A filter the browser restored on back navigation applies again.
    applyFilter();
    document.getElementById("toolbar").hidden = false;
    document.getElementById("listing").hidden = false;
    // A shared link, Forward navigation and reload open the preview's image.
    restorePreview(true);
    showReadme().catch(() => {});
  })
  .catch(error => {
    showNotice(["Could not load this folder (" + error.message + "). Reload the page or open the ",
      plainListingLink("plain listing"), "."]);
  });

document.querySelector(".head").addEventListener("click", event => {
  const button = event.target.closest(".sort");
  if (!button) return;
  const key = button.dataset.key;
  // Size and date read most usefully largest and newest first.
  sort = sort.key === key
    ? { key, order: sort.order === "asc" ? "desc" : "asc" }
    : { key, order: key === "name" ? "asc" : "desc" };
  saveSort();
  applySort();
});

list.addEventListener("click", event => {
  const button = event.target.closest(".copy");
  if (button) copyLink(button, button.closest(".entry").querySelector(".name").getAttribute("href"));
  // A modified click still opens the image itself, as in a new tab.
  if (!event.target.closest(".name") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const entry = entries.find(item => item.row === event.target.closest(".entry"));
  if (entry?.previewable) {
    event.preventDefault();
    openPreview(entry);
  }
});

// Buttons step by their data-step, 0 closes, and so does a click above,
// below or between the step sides beside the image.
preview.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (button) {
    const step = Number(button.dataset.step);
    if (step) {
      showImage(galleryIndex + step);
    } else {
      closePreview();
    }
  } else if (event.target === previewStage || event.target === preview) {
    closePreview();
  }
});
preview.addEventListener("keydown", event => {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  if (step && gallery.length > 1) {
    event.preventDefault();
    showImage(galleryIndex + step);
  }
});
// A horizontal swipe steps; anything else, such as pinch zoom, does not.
let swipeStart = null;
previewStage.addEventListener("touchstart", event => {
  const [touch] = event.touches;
  swipeStart = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
}, { passive: true });
previewStage.addEventListener("touchend", event => {
  const start = swipeStart;
  swipeStart = null;
  // A zoomed-in page pans instead.
  if (!start || event.touches.length || gallery.length < 2 || window.visualViewport?.scale > 1) return;
  const dx = event.changedTouches[0].clientX - start.x;
  const dy = event.changedTouches[0].clientY - start.y;
  if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(dy)) showImage(galleryIndex + (dx < 0 ? 1 : -1));
});
preview.addEventListener("cancel", event => {
  event.preventDefault();
  closePreview();
});

filter.addEventListener("input", applyFilter);
filter.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    filter.value = "";
    applyFilter();
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "/" && !preview.open && document.activeElement !== filter && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    filter.focus();
  }
});
