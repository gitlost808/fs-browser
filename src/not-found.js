import { decode } from "./files.js";
import { renderBreadcrumbs } from "./dom.js";
import { fetchListing } from "./http.js";

document.title = "Not found · " + location.host;

// At most this many similarly named entries are suggested.
const SUGGESTION_LIMIT = 5;

const path = location.pathname;
const segments = path.split("/").filter(Boolean);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function directoryUrl(depth) {
  return "/" + segments.slice(0, depth).map((segment) => segment + "/").join("");
}

function displayPath(depth) {
  return "/" + segments.slice(0, depth).map((segment) => decode(segment) + "/").join("");
}

function renderPath() {
  renderBreadcrumbs(document.getElementById("path"), path, location.host);
  const target = document.createElement("code");
  target.textContent = decode(path);
  document.getElementById("explanation").replaceChildren(
    "Nothing is shared at ", target,
    ". It may have been moved, renamed or deleted, or the link may be mistyped.");
}

// The nearest enclosing directory with a JSON listing, and its entries.
// Missing directories answer with this page, protected ones redirect to a
// sign-in, and directories without listings are refused; all are skipped.
async function nearestListing() {
  for (let depth = segments.length - 1; depth >= 0; depth--) {
    try {
      const entries = await fetchListing(directoryUrl(depth), { redirect: "error" });
      return { depth, entries };
    } catch {
      // Try the next directory up.
    }
  }
  return null;
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

function stem(name) {
  return name.includes(".", 1) ? name.slice(0, name.lastIndexOf(".")) : name;
}

// Case changes, a different extension and small typos all count as close.
function similarity(wanted, name) {
  const a = wanted.toLowerCase();
  const b = name.toLowerCase();
  if (a === b) return 0;
  if (stem(a) === stem(b)) return 1;
  const distance = editDistance(a, b);
  return distance <= Math.max(2, Math.floor(Math.max(a.length, b.length) / 3)) ? distance + 1 : null;
}

function showSuggestions(depth, entries) {
  const wanted = decode(segments[depth]);
  const matches = entries
    .map((entry) => ({ entry, score: similarity(wanted, entry.name) }))
    .filter((match) => match.score !== null)
    .sort((a, b) => a.score - b.score || collator.compare(a.entry.name, b.entry.name))
    .slice(0, SUGGESTION_LIMIT);
  if (!matches.length) return;
  const list = document.getElementById("suggestion-list");
  for (const { entry } of matches) {
    const folder = entry.type === "directory";
    const item = document.createElement("li");
    item.dataset.kind = folder ? "folder" : "file";
    const link = document.createElement("a");
    link.href = directoryUrl(depth) + encodeURIComponent(entry.name) + (folder ? "/" : "");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", folder ? "#i-folder" : "#i-file");
    icon.append(use);
    link.append(icon, entry.name + (folder ? "/" : ""));
    item.append(link);
    list.append(item);
  }
  document.getElementById("suggestions").hidden = false;
}

async function main() {
  renderPath();
  const listing = await nearestListing();
  if (!listing) return;
  if (listing.depth) {
    const nearest = document.getElementById("nearest");
    nearest.href = directoryUrl(listing.depth);
    nearest.querySelector("use").setAttribute("href", "#i-up");
    nearest.querySelector("span").textContent = "Open " + displayPath(listing.depth);
    document.getElementById("root").hidden = false;
  }
  if (listing.depth < segments.length - 1) {
    const missing = document.createElement("code");
    missing.textContent = displayPath(listing.depth + 1);
    const note = document.getElementById("nearest-note");
    note.replaceChildren("The folder ", missing, " does not exist either.");
    note.hidden = false;
  }
  showSuggestions(listing.depth, listing.entries);
}

main();
