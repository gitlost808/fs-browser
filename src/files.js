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
export function languageFor(name, config = globalThis.FS_BROWSER_CONFIG) {
  const extension = extensionOf(name);
  if (Object.hasOwn(config.extensions, extension)) return config.extensions[extension];
  const key = Object.keys(config.fileNames).find(key => key.toLowerCase() === name.toLowerCase());
  return config.fileNames[key];
}
