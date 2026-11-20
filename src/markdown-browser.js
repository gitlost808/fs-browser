import { isMarkdown, readLimitedText, renderMarkdown } from "./markdown.js";
globalThis.FS_BROWSER_MARKDOWN = { isMarkdown, readLimitedText, renderMarkdown };
