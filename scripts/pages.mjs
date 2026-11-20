import fs from "node:fs";
import path from "node:path";

const pages = new URL("../src/pages/", import.meta.url);
const read = name => fs.readFileSync(new URL(name + ".html", pages), "utf8");

// Templates contain only trusted source HTML and named slots, with no runtime
// rendering or template dependency shipped to the browser.
function render(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Unknown page slot: ${name}`);
    return values[name];
  });
}

export function buildPages(output) {
  const layout = read("layout");
  const partials = { icons: read("icons"), breadcrumbs: read("breadcrumbs") };
  for (const [name, entry] of [["index", "viewer"], ["listing", "listing"], ["404", "not-found"]]) {
    const document = name !== "404";
    fs.writeFileSync(path.join(output, name + ".html"), render(layout, {
      title: document ? "Files" : "Not found · Files",
      entry,
      head: document ? '<link rel="stylesheet" href="/.fs-viewer/document.css">' : '<meta name="robots" content="noindex">',
      body: render(read(name), partials),
      scripts: document ? ["highlight", "markdown", "config"].map(name =>
        `  <script src="/.fs-viewer/${name}.js"></script>`).join("\n") : "",
    }));
  }
}
