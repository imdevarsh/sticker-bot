import { randomBytes } from "crypto";
import type { App, StringIndexed } from "@slack/bolt";
import sharp from "sharp";

import { make67Sticker } from "./67ify.ts";
import { emojiProxyRequest } from "./emoji-proxy.ts";
import { env } from "./env";
import {
  downloadSlackImage,
  IMAGE_OPTIONS,
  validateImageMetadata,
  validateStickerInput,
} from "./security.ts";

async function updateEmojiCache() {
  if (!env.EMOJI_CACHE_UPDATE_URL || !env.EMOJI_CACHE_UPDATE_TOKEN) return;
  try {
    await fetch(env.EMOJI_CACHE_UPDATE_URL, {
      method: "POST",
      headers: {
        "X-Token": env.EMOJI_CACHE_UPDATE_TOKEN,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error(error);
  }
}

function secondsToNice(seconds: number) {
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export function recommendedStickerDimensions(
  width: number,
  height: number,
): number[] {
  const aspectRatio = width / height;
  let bestFit = [Math.min(3, width), Math.min(3, height)];
  let bestDiff = Math.abs(bestFit[0]! / bestFit[1]! - aspectRatio);
  let bestArea = bestFit[0]! * bestFit[1]!;

  for (let rows = 1; rows <= 16; rows++) {
    for (let cols = 1; cols <= 16; cols++) {
      const ratio = cols / rows;
      const diff = Math.abs(ratio - aspectRatio);
      const area = rows * cols;
      if (cols > width || rows > height) continue;

      if (
        diff < bestDiff ||
        (diff === bestDiff && Math.abs(area - 9) < Math.abs(bestArea - 9))
      ) {
        bestDiff = diff;
        bestFit = [cols, rows];
        bestArea = area;
      }
    }
  }

  return bestFit;
}

export function randomChars(len = 2): string {
  return randomBytes(len).toString("hex");
}

export function isImageFile(mimeType: string): boolean {
  return ["image/gif", "image/jpeg", "image/png", "image/webp"].includes(
    mimeType,
  );
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function deleteEmojis({
  emojis,
  onDeleted,
}: {
  emojis: string[];
  onDeleted?: (name: string) => Promise<void>;
}) {
  const signal = AbortSignal.timeout(10 * 60_000);
  for (const name of emojis) {
    await emojiProxyRequest(
      env.SLACK_EMOJI_PROXY_URL,
      env.SLACK_EMOJI_PROXY_TOKEN,
      "remove",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        signal,
      },
    );
    await onDeleted?.(name);
  }
}

export async function uploadEmoji({
  emojiName,
  image,
  type,
  signal,
}: {
  emojiName: string;
  image: Buffer<ArrayBuffer>;
  type: string;
  signal?: AbortSignal;
}) {
  if (image.byteLength > 128 * 1024)
    throw new Error("Emoji exceeds the proxy's 128 KiB limit");
  const form = new FormData();
  form.append("name", emojiName);
  form.append("file", new Blob([image]), "image." + type);
  await emojiProxyRequest(
    env.SLACK_EMOJI_PROXY_URL,
    env.SLACK_EMOJI_PROXY_TOKEN,
    "upload",
    { method: "POST", body: form, signal },
  );
  await sleep(250);
}

export async function createSticker({
  fileUrl,
  title,
  width,
  height,
  channel,
  timestamp,
  app,
  sixtySeven = false,
  beforeUpload,
  afterUpload,
}: {
  fileUrl: string;
  title: string;
  width: number;
  height: number;
  channel: string;
  timestamp: string;
  app: App<StringIndexed>;
  sixtySeven?: boolean;
  beforeUpload?: (name: string) => Promise<void>;
  afterUpload?: (name: string) => Promise<void>;
}): Promise<string[]> {
  await app.client.chat.postMessage({
    channel: channel,
    thread_ts: timestamp,
    text: `Creating new ${width}x${height} ${sixtySeven ? "67ified " : ""}sticker: "${title}"`,
  });

  validateStickerInput(title, width, height);
  const signal = AbortSignal.timeout(10 * 60_000);
  const source = await downloadSlackImage(
    fileUrl,
    env.SLACK_BOT_TOKEN,
    fetch,
    signal,
  );
  const image = sharp(
    sixtySeven ? await make67Sticker(source, width, height, signal) : source,
    IMAGE_OPTIONS,
  ).timeout({ seconds: 30 });
  const imgMetadata = await image.metadata();
  validateImageMetadata(imgMetadata);
  const imgWidth = imgMetadata.width;
  const imgHeight = imgMetadata.pageHeight || imgMetadata.height;
  const isAnimated = Boolean(imgMetadata.pages && imgMetadata.pages > 1);

  if (width > imgWidth || height > imgHeight)
    throw new Error("Sticker grid exceeds image dimensions");
  const emojis: string[] = [];

  const startTime = Date.now();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      signal.throwIfAborted();
      const newImg = image
        .clone()
        .extract({
          left: Math.floor((imgWidth / width) * x),
          top: Math.floor((imgHeight / height) * y),
          width: Math.floor(imgWidth / width),
          height: Math.floor(imgHeight / height),
        })
        .resize({
          // Recommended slack emoji size is 128x128
          width: Math.min(
            128,
            Math.floor(Math.max(imgWidth / width, imgHeight / height)),
          ),
          height: Math.min(
            128,
            Math.floor(Math.max(imgWidth / width, imgHeight / height)),
          ),
          fit: "fill",
        });

      if (sixtySeven) newImg.gif({ keepDuplicateFrames: true });

      if (isAnimated && (await newImg.toBuffer()).byteLength / 1000 > 128) {
        let quality = 60;
        while (quality >= 10) {
          const testingBuf = await newImg
            .clone()
            .webp({
              effort: 4, // change this to 5 or 6 if you're self-hosting and are fine with lots of cpu usage
              quality: quality,
            })
            .toBuffer();
          // yeah, I know it's 1000 not 1024, it's for a safe buffer zone
          if (testingBuf.byteLength / 1000 < 128) {
            newImg.webp({
              effort: 4, // same here
              quality: quality,
            });
            break;
          }
          quality -= 10;
        }
      }

      const { data: buf, info } = await newImg.toBuffer({
        resolveWithObject: true,
      });

      const emojiName = `${title}-${x + 1}-${y + 1}-${randomChars(8)}`;
      if (buf.byteLength > 128 * 1024)
        throw new Error("Emoji exceeds the proxy's 128 KiB limit");
      await beforeUpload?.(emojiName);
      console.log(
        "trying to upload " + emojiName,
        "size:",
        (buf.byteLength / 1024).toFixed(3) + "kb",
      );
      await uploadEmoji({
        emojiName: emojiName,
        image: Buffer.from(buf), // don't ask why this works
        type: info.format,
        signal,
      });
      emojis.push(emojiName);
      await afterUpload?.(emojiName);
    }

    if (y !== height - 1) {
      const completedSoFar = (y + 1) * width;
      await app.client.chat.postMessage({
        channel: channel,
        thread_ts: timestamp,
        text: `Finished row ${y + 1}! ${completedSoFar}/${width * height} done so far. ETA: ${secondsToNice(
          Math.ceil(
            (((Date.now() - startTime) / completedSoFar) *
              (width * height - completedSoFar)) /
              1000,
          ),
        )}`,
      });
    }
  }

  await updateEmojiCache();

  return emojis;
}

export function formatSticker(emojis: string[], width: number): string {
  return emojis
    .map((x) => `:${x}:`)
    .map((x, i) => {
      if ((i + 1) % width === 0) return x + "\n";
      return x;
    })
    .join("");
}
