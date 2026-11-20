import hljs from "highlight.js/lib/common";
import nginx from "highlight.js/lib/languages/nginx";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import nix from "highlight.js/lib/languages/nix";
import django from "highlight.js/lib/languages/django";

// Keep the common browser bundle's language set plus the deployed additions.
for (const [name, grammar] of Object.entries({ nginx, dockerfile, nix, django })) {
  hljs.registerLanguage(name, grammar);
}
export default hljs;
