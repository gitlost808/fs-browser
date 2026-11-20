import fileTypes from "./file-types.json" with { type: "json" };

// File names need not be UTF-8; retain invalid components percent-encoded.
export function decode(component) {
  try {
    return decodeURIComponent(component);
  } catch {
    return component;
  }
}

export function extensionOf(name) {
  const lower = name.toLowerCase();
  return lower.includes(".") ? lower.split(".").pop() : "";
}

// Match the same extension/exact-name mappings as Nginx.
export function languageFor(name) {
  const extension = extensionOf(name);
  if (Object.hasOwn(fileTypes.extensions, extension)) return fileTypes.extensions[extension];
  const key = Object.keys(fileTypes.fileNames).find(key => key.toLowerCase() === name.toLowerCase());
  return fileTypes.fileNames[key];
}
