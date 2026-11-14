# Nginx file browser

A static frontend for Nginx file shares: directory listings, sorting and
filtering, README display, image previews with shareable browser history,
source highlighting, raw/download links, and helpful 404 pages. No backend,
package installation, external CDN, or framework is needed.

## Development

Use Node.js and Python 3. Run `make test` or `make preview`, then open
http://127.0.0.1:8088. The preview server uses only `examples/files` and
emulates the HTTP contract below; it does not emulate production authentication.
`examples/config.json` is sample configuration, not production inventory.

## Build and release

Run `bash deploy.sh /absolute/path/to/empty-staging-directory`. The build
copies `public/` and generates `contract.json` containing contract version 1
and the languages supported by the bundled highlighter. It requires Node.js
and installs no dependencies. Site configuration is supplied by the consumer
and is deliberately excluded from the output.

The infra repository selects a full commit SHA and publishes through its
existing isolated static-site publisher. Pushing here does not deploy it.
Reverting the infra version pin restores the earlier frontend release.

## HTTP integration contract (version 1)

- Serve the release's assets at `/.fs-viewer/`, with revalidation on every
  request. `index.html` and `listing.html` are internal rewrite targets served
  at the requested file or directory URL. Serve `404.html` with status 404
  at the missing URL. Do not change the file-share root to the asset root.
- Supply `/.fs-viewer/config.js`, loaded before the frontend's inline scripts:
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

`public/*.min.js` and `public/github*.min.css` are unmodified highlight.js
11.12.0 assets from `@highlightjs/cdn-assets` (BSD-3-Clause). The common
bundle is supplemented by nginx, dockerfile, nix, and django grammars. Keep
all files on one version when upgrading and run the tests afterward.
