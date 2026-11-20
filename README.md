# Nginx file browser

A static frontend for Nginx file shares: directory listings, sorting and
filtering, README display, image previews with shareable browser history,
source highlighting, raw/download links, and helpful 404 pages. The deployed
site needs no backend, external CDN, or framework.
Dependencies are installed only when building.

## Development

Use Node.js 24+ (matching CI), npm, and Python 3. Run `npm ci` once,
then `make test` or `make preview`. For preview, open
http://127.0.0.1:8088. The preview server uses only `examples/files` and
emulates the HTTP contract below; it does not emulate production authentication.
`examples/config.json` is sample configuration, not production inventory.

## Build and release

Run `bash deploy.sh /absolute/path/to/empty-staging-directory`. The build
runs `npm ci` from the committed `package-lock.json`, bundles `src/` with
esbuild, copies the HTML in `public/`, and generates `contract.json` containing
contract version 1 and the languages registered by `src/highlighter.js`.
The build machine needs Node.js 24+, npm, and registry access (or a populated
npm cache), including development dependencies for esbuild. The release script explicitly
includes those dependencies and disables dependency lifecycle scripts. Site configuration
is supplied by the consumer and is deliberately excluded from the output.

`npm run build` rebuilds the ignored `dist/` directory for local use.
`npm run build -- /absolute/empty/staging` requires an existing empty directory
and refuses to overwrite a release. Preview serves `dist/` using the same
absolute `/.fs-viewer/` asset URLs as production; it rebuilds on startup.
Restart preview after source changes. Generated bundles and `node_modules/`
are never committed.

The infra repository selects a full commit SHA and publishes through its
existing isolated static-site publisher. Pushing here does not deploy it.
Reverting the infra version pin restores the earlier frontend release.

## HTTP integration contract (version 1)

- Serve the release's assets at `/.fs-viewer/`, with revalidation on every
  request. `index.html` and `listing.html` are internal rewrite targets served
  at the requested file or directory URL. Serve `404.html` with status 404
  at the missing URL. Do not change the file-share root to the asset root.
- Supply `/.fs-viewer/config.js`, loaded before the frontend scripts:
  `globalThis.FS_BROWSER_CONFIG = {"version":1,"extensions":{"py":"python"},"fileNames":{"Makefile":"makefile"}};`
  Keys match case-insensitively; a value is a highlight.js language or list of
  candidates. Use this same configuration to select highlighted URLs in Nginx.
  Verify every selected language against the built `contract.json`.
- File `?raw` returns its bytes; `?download` returns those bytes as an
  attachment. Ordinary browser navigation to a configured source filename
  returns `index.html`, while other files retain normal browser handling.
- Directory `?json` returns Nginx autoindex JSON: an array with `name`,
  `type` (`file` or `directory`), `mtime`, and file `size`. Directory `?raw`
  keeps the server's plain listing. An existing `index.html` takes precedence.
- Vary negotiated responses by `Accept` and `Sec-Fetch-Dest`. Directory
  responses and frontend assets revalidate; raw file caching is site policy.
- Keep JSON listings behind the same access controls as directory navigation.
  Authentication, filesystem roots, TLS, and host-specific Nginx configuration
  belong to the deploying repository. Generic UI assets contain no private data.

The asset prefix and query parameters form the current contract. Changes to
them require a coordinated consumer update and a contract version change.

## Dependencies and provenance

The history before the extraction commit comes from `nginx/static/fs-viewer/`
in `gitlost808/infra` using `git subtree split`; frontend tests were moved
from that repository in the extraction commit.

`highlight.js` is an npm dependency (BSD-3-Clause); esbuild is a build-only
dependency (MIT). The common language set plus nginx, dockerfile, nix, and
django is shared by the browser bundle and contract generation. Themes come
from the same locked highlight.js version. Releases include its license and
esbuild's extracted legal comments. Update dependencies with npm, commit both
package manifests, and run `make test` before changing the infra pin.

## Markdown rendering follow-up

This change establishes the build workflow; README display remains plain text.
A follow-up can import a Markdown parser and an HTML sanitizer from npm into
shared rendering code used by directory READMEs and the file viewer. Sanitize
parser output before inserting HTML: shared files must be treated as untrusted
content. Cover scripts, event handlers, unsafe link schemes, and raw HTML in
regression tests. Resolve relative links/images against the displayed file's
directory, preserve raw/download links and size limits, and use the existing
highlighter for fenced code without broadening its language set implicitly.

Start with directory README rendering, which needs no new route. Rendering
standalone `.md` files also needs a coordinated infra change to select those
URLs and advertise any new runtime setting in the integration contract. Keep
that behavior separate from this dependency/build migration so rollout and
rollback remain easy to review.
