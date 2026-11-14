import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[2];
if (!output || !fs.statSync(output).isDirectory() || fs.readdirSync(output).length) {
  throw new Error("Usage: node scripts/build.mjs EMPTY_STAGING_DIRECTORY");
}

const context = vm.createContext({});
for (const name of ["highlight", "nginx", "dockerfile", "nix", "django"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "public", `${name}.min.js`), "utf8"), context);
}
for (const name of fs.readdirSync(path.join(root, "public"))) {
  fs.copyFileSync(path.join(root, "public", name), path.join(output, name));
}
fs.writeFileSync(path.join(output, "contract.json"), JSON.stringify({
  version: 1,
  languages: vm.runInContext("hljs.listLanguages()", context).sort(),
}) + "\n");
