# Nginx file browser

A static frontend for Nginx file shares with directory listings, Markdown
READMEs, source highlighting, image previews, and raw/download links.

## Development

Requires Node.js 24.15+, npm, and Python 3. Run `npm ci`, then `make test`
or `make preview` (http://127.0.0.1:8088). Preview serves `examples/files`
using `examples/config.json`; restart it after source changes.

## Build and release

`npm run build` bundles into the ignored `dist/` directory. For deployment,
run `bash deploy.sh /absolute/empty/staging`: it installs locked dependencies,
builds with esbuild, and generates `contract.json`. The build needs npm registry
access or a populated cache. Runtime configuration comes from the consumer.

Infra pins a full commit SHA and publishes the static output. Pushing here
does not deploy it; restoring the previous infra pin rolls back the release.

## Markdown

Directory listings render `README.md`, `README.markdown`, and extensionless
`README`; `README.txt` stays plain text. Standalone `.md` and `.markdown` files
render when mapped to `markdown` in the consumer's extension configuration.
Matching is case-insensitive. README previews are limited to 64 KiB; files
over 1 MiB fall back to truncated source.

Marked parses Markdown and DOMPurify sanitizes the HTML. Relative links/images
resolve from the document directory; fenced code uses highlight.js. Raw and
download links return the original bytes.

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

Dependencies are managed through npm and `package-lock.json`; generated assets
and `node_modules/` are excluded from Git. Commit both manifests when updating
dependencies and run `make test`. Releases include dependency licenses.

History before extraction comes from `nginx/static/fs-viewer/` in
`gitlost808/infra`, preserved with `git subtree split`.
