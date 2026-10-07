export const IMAGE_OPTIONS = { animated: true, limitInputPixels: 40_000_000 };
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function validDimensions(width: number, height: number) {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= 16 &&
    height <= 16
  );
}

export function validateStickerInput(
  title: string,
  width: number,
  height: number,
) {
  if (!/^[a-z0-9_-]{1,50}$/.test(title) || !validDimensions(width, height)) {
    throw new Error("Invalid sticker name or dimensions");
  }
}

export function validateImageMetadata(meta: {
  width: number;
  height: number;
  pages?: number;
  pageHeight?: number;
  format?: string;
}) {
  if (
    !meta.width ||
    !meta.height ||
    (meta.pages ?? 1) > 50 ||
    meta.width * meta.height > IMAGE_OPTIONS.limitInputPixels ||
    !["png", "jpeg", "gif", "webp"].includes(meta.format ?? "")
  ) {
    throw new Error("Unsupported image or image exceeds pixel/frame limits");
  }
}

export async function downloadSlackImage(
  urlString: string,
  token: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const url = new URL(urlString);
  // Only Slack's private file host receives the bot credential. Never follow redirects.
  if (
    url.protocol !== "https:" ||
    url.hostname !== "files.slack.com" ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error("Untrusted Slack file URL");
  }
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(30_000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok || !response.body)
    throw new Error("Could not download Slack image");
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    await response.body.cancel();
    throw new Error("Image exceeds 10 MiB");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("Image exceeds 10 MiB");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
