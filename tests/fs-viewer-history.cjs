// Exercise the rendered listing script with a small DOM/history fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor() {
    this.listeners = {};
    this.dataset = {};
    this.open = false;
    this.hidden = false;
    this.value = "";
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  fire(type, event = {}) { this.listeners[type]?.(event); }
  append() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  removeAttribute(name) { delete this[name]; }
  replaceWith(image) { currentImage = image; }
  querySelector() { return currentImage; }
  querySelectorAll() { return []; }
}

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
}
let currentImage = new Element();
const window = new Element();
const document = new Element();
document.getElementById = element;
document.querySelector = element;
document.createElement = () => new Element();

// Each entry keeps its state and the fragment of its URL.
let states = [{ previousPage: true }, { listing: "original" }];
let hashes = ["", ""];
const pending = [];
let position = 1;
function hashOf(url, current) {
  return url === undefined ? current : url.includes("#") ? url.slice(url.indexOf("#")) : "";
}
const history = {
  get state() { return states[position]; },
  pushState(state, _, url) {
    hashes.splice(position + 1, Infinity, hashOf(url, hashes[position]));
    states.splice(++position, Infinity, structuredClone(state));
  },
  replaceState(state, _, url) {
    hashes[position] = hashOf(url, hashes[position]);
    states[position] = structuredClone(state);
  },
  // Browser traversals are asynchronous, including those from dismissal.
  back() { pending.push(-1); },
  forward() { pending.push(1); },
};
function settleNavigation() {
  while (pending.length) {
    position += pending.shift();
    assert.ok(position >= 0 && position < states.length);
    window.fire("popstate", { state: history.state });
  }
}

const context = vm.createContext({
  document, window, history, Image: Element,
  FS_BROWSER_CONFIG: require("../examples/config.json"),
  location: { pathname: "/", search: "", host: "files.example", get hash() { return hashes[position]; } },
  // Supply the loaded entries below, without network or production data.
  fetch: () => new Promise(() => {}),
});
vm.runInContext(fs.readFileSync(0, "utf8"), context);
vm.runInContext(`
  entries = ["photo #1.png", "photo 2.png", "hidden.png"].map(name => ({
    name, href: encodeURIComponent(name), size: 10, previewable: true,
    row: { hidden: name === "hidden.png" },
  }));
`, context);
const preview = element("preview");
const filter = element("filter");
filter.value = "photo";
const rows = vm.runInContext("entries.map(entry => entry.row)", context);

function open(modified = false) {
  let prevented = false;
  element("entries").fire("click", {
    ctrlKey: modified,
    target: { closest: selector => ({ ".name": {}, ".entry": rows[0] })[selector] },
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, !modified);
}
function click(target) { preview.fire("click", { target }); }
function button(step) {
  return { closest: () => ({ dataset: { step: String(step) } }) };
}
function assertListing() {
  assert.equal(preview.open, false);
  assert.equal(currentImage.src, undefined, "closing stops the image download");
  assert.equal(position, 1, "returns to the listing's original entry");
  assert.deepEqual(history.state, { listing: "original" });
  assert.equal(hashes[position], "", "the listing URL names no image");
  assert.equal(filter.value, "photo");
  assert.equal(rows[2].hidden, true);
}

open(true);
assert.equal(preview.open, false);
assert.equal(states.length, 2, "modified clicks keep native image navigation");

open();
assert.equal(preview.open, true);
assert.equal(currentImage.src, "photo%20%231.png");
assert.equal(hashes[position], "#photo%20%231.png", "the preview URL names its image");
preview.fire("keydown", { key: "ArrowRight", preventDefault() {} });
assert.equal(currentImage.src, "photo%202.png");
assert.equal(hashes[position], "#photo%202.png", "stepping updates the shared URL");
assert.equal(states.length, 3, "stepping does not add Back steps");
assert.equal(history.state.listing, "original", "preserves other history state");
history.back();
settleNavigation();
assertListing();

history.forward();
settleNavigation();
assert.equal(preview.open, true);
assert.equal(currentImage.src, "photo%202.png", "Forward restores the last image");
assert.equal(states.length, 3, "restoring does not push another entry");

for (const dismiss of [
  () => click(button(0)),
  () => preview.fire("cancel", { preventDefault() {} }),
  () => click(Object.assign(element("preview-stage"), { closest: () => null })),
  () => click(Object.assign(preview, { closest: () => null })),
]) {
  dismiss();
  dismiss(); // Repeated dismissal cannot navigate back twice.
  settleNavigation();
  assertListing();
  open();
  assert.equal(position, 2);
  assert.equal(states.length, 3, "reopening replaces the forward entry");
}

click(button(1));
assert.equal(currentImage.src, "photo%202.png");
click(button(0));
open(); // Reopening before popstate must not add an intervening history entry.
assert.equal(position, 2);
assert.equal(states.length, 3);
settleNavigation();
assertListing();
open();
history.back();
settleNavigation();
assertListing();
history.back();
settleNavigation();
assert.equal(position, 0, "the next Back leaves the listing normally");
assert.equal(preview.open, false);

// A shared preview link opens its image over the listing, which closing and
// Back return to; a fragment left unencoded still matches.
for (const [hash, src] of [["#photo%202.png", "photo%202.png"], ["#photo%20#1.png", "photo%20%231.png"], ["#hidden.png", "hidden.png"]]) {
  states = [{ previousPage: true }, null];
  hashes = ["", hash];
  position = 1;
  vm.runInContext("restorePreview(true)", context);
  assert.equal(preview.open, true);
  assert.equal(currentImage.src, src, "a shared link opens its image, even when filtered out");
  assert.equal(position, 2);
  assert.equal(hashes[2], hash.replace("#1", "%231"), "the preview keeps its canonical URL");
  click(button(0));
  settleNavigation();
  assert.equal(preview.open, false);
  assert.equal(position, 1);
  assert.equal(hashes[1], "", "closing returns to the plain listing URL");
  history.back();
  settleNavigation();
  assert.equal(position, 0, "the next Back leaves the folder");
}

// A link to a missing image just shows the listing.
states = [{ previousPage: true }, null];
hashes = ["", "#gone.png"];
position = 1;
vm.runInContext("restorePreview(true)", context);
assert.equal(preview.open, false);
assert.equal(states.length, 2);

// Editing the fragment opens that image; closing goes back past it.
states = [{ listing: "original" }];
hashes = [""];
position = 0;
history.pushState(null, "", "#photo%202.png");
window.fire("popstate", { state: null });
assert.equal(preview.open, true);
assert.equal(currentImage.src, "photo%202.png");
assert.equal(states.length, 2, "an edited fragment adds no further entry");
click(button(0));
settleNavigation();
assert.equal(preview.open, false);
assert.equal(position, 0);
