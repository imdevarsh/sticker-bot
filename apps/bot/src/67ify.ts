import sharp from "sharp";

import {
  IMAGE_OPTIONS,
  validateImageMetadata,
  validDimensions,
} from "./security.ts";

// Adapted from imdevarsh/67ify's server/lib/67ify.ts (mode 67).
// Animate the complete canvas before slicing it, so every tile shares one motion.
export async function make67Sticker(
  image: Buffer,
  columns: number,
  rows: number,
  signal?: AbortSignal,
) {
  if (!validDimensions(columns, rows))
    throw new Error("Invalid sticker name or dimensions");
  const meta = await sharp(image, IMAGE_OPTIONS).metadata();
  validateImageMetadata(meta);
  const sourceHeight = meta.pageHeight || meta.height;
  if (columns > meta.width || rows > sourceHeight)
    throw new Error("Sticker grid exceeds image dimensions");

  const pages = meta.pages || 1;
  const frameCount = pages > 1 ? pages : 18;
  // Bound both the canvas and the decoded output, including static-to-animated expansion.
  const scale = Math.min(
    1,
    1024 / Math.max(meta.width, sourceHeight),
    Math.sqrt(
      IMAGE_OPTIONS.limitInputPixels / (meta.width * sourceHeight * frameCount),
    ),
  );
  const width = Math.max(columns, Math.floor(meta.width * scale));
  const height = Math.max(rows, Math.floor(sourceHeight * scale));
  const safeScale = Math.min(0.9, height / (height + width * 0.3));
  const frameWidth = Math.max(1, Math.round(width * safeScale));
  const frameHeight = Math.max(1, Math.round(height * safeScale));
  const frames: Buffer[] = [];
  const delays: number[] = [];

  for (let i = 0; i < frameCount; i++) {
    signal?.throwIfAborted();
    const page = pages > 1 ? i : 0;
    const transformed = await sharp(image, { ...IMAGE_OPTIONS, page, pages: 1 })
      .ensureAlpha()
      .resize(frameWidth, frameHeight, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .affine([1, 0, Math.sin((i / frameCount) * Math.PI * 2) * 0.3, 1], {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .timeout({ seconds: 30 })
      .toBuffer();

    frames.push(
      await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: transformed, gravity: "center" }])
        .png()
        .timeout({ seconds: 30 })
        .toBuffer(),
    );
    // Still GIFs can carry a zero delay; give generated frames a real duration.
    delays.push(pages > 1 ? meta.delay?.[page] || 100 : 100);
  }

  return sharp(frames, { join: { animated: true } })
    .gif({ delay: delays, loop: 0, keepDuplicateFrames: true })
    .timeout({ seconds: 30 })
    .toBuffer();
}
