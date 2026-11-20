export async function fetchListing(directory, options) {
  const response = await fetch(directory + "?json", options);
  if (!response.ok) throw new Error(response.status + " " + response.statusText);
  const entries = await response.json();
  if (!Array.isArray(entries)) throw new Error("unexpected listing format");
  return entries;
}

// Retain at most limit bytes, but read far enough to detect truncation.
export async function readBytes(response, limit) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - size;
      chunks.push(value.subarray(0, remaining));
      size += Math.min(remaining, value.length);
      if (value.length > remaining) {
        truncated = true;
        break;
      }
    }
  } finally {
    await reader.cancel();
  }
  return { bytes: new Uint8Array(await new Blob(chunks).arrayBuffer()), truncated };
}

export async function readLimitedText(response, limit) {
  const { bytes, truncated } = await readBytes(response, limit);
  if (truncated) throw new Error("Response exceeds the preview limit");
  return new TextDecoder().decode(bytes);
}
