import { error } from "@sveltejs/kit";

export async function readSmallJSON(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    error(415, "Expected JSON");
  if (Number(request.headers.get("content-length")) > 8192)
    error(413, "Request too large");
  const reader = request.body?.getReader();
  if (!reader) error(400, "Invalid request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) error(413, "Request too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    error(400, "Invalid JSON");
  }
}
