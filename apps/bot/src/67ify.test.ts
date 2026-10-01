import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";

import { make67Sticker } from "./67ify.ts";
import { IMAGE_OPTIONS } from "./security.ts";
import { stickerEffectCheckbox, wants67 } from "./sticker-effect.ts";

const solid = (width: number, height: number, background = "red") =>
  sharp({ create: { width, height, channels: 4, background } })
    .png()
    .toBuffer();

test("67ify is opt-in and can be cleared in either Slack flow", () => {
  assert.equal(wants67(), false);
  assert.equal(wants67({ values: {} }), false);
  assert.equal(stickerEffectCheckbox().initial_options, undefined);
  for (const selected_options of [[], null, [{ value: "55" }]]) {
    assert.equal(
      wants67({
        values: { sticker_effect: { sticker_effect: { selected_options } } },
      }),
      false,
    );
  }
  const state = {
    values: {
      sticker_effect: {
        sticker_effect: { selected_options: [{ value: "67" }] },
      },
    },
  };
  assert.equal(wants67(state), true);
  assert.deepEqual(
    stickerEffectCheckbox(wants67(state)).initial_options?.map((o) => o.value),
    ["67"],
  );
});

test("static images become a looping, transparent, visibly moving 18-frame GIF", async () => {
  const output = await make67Sticker(await solid(96, 64), 3, 2);
  const meta = await sharp(output, IMAGE_OPTIONS).metadata();
  assert.equal(meta.format, "gif");
  assert.equal(meta.pages, 18);
  assert.equal(meta.width, 96);
  assert.equal(meta.pageHeight, 64);
  assert.equal(meta.loop, 0);
  assert.equal(meta.hasAlpha, true);
  assert.deepEqual(meta.delay, Array(18).fill(100));
  const frame = (page: number) =>
    sharp(output, { page, pages: 1 }).raw().toBuffer();
  assert.notDeepEqual(await frame(0), await frame(4));
  // Exercise the exact animated extraction used for each sticker tile.
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 3; x++) {
      const tile = await sharp(output, IMAGE_OPTIONS)
        .extract({ left: x * 32, top: y * 32, width: 32, height: 32 })
        .resize(32, 32)
        .gif({ keepDuplicateFrames: true })
        .toBuffer();
      const tileMeta = await sharp(tile, IMAGE_OPTIONS).metadata();
      assert.equal(tileMeta.pages, meta.pages);
      assert.deepEqual(tileMeta.delay, meta.delay);
      assert.equal(tileMeta.width, 32);
      assert.equal(tileMeta.pageHeight, 32);
      assert.ok(tile.byteLength <= 128 * 1024);
    }
  }
});

test("animated sources retain their frames and timing", async () => {
  const source = await sharp(
    [await solid(48, 48, "red"), await solid(48, 48, "blue")],
    { join: { animated: true } },
  )
    .gif({ delay: [80, 160], loop: 0 })
    .toBuffer();
  const result = await make67Sticker(source, 2, 2);
  const meta = await sharp(result, IMAGE_OPTIONS).metadata();
  assert.equal(meta.pages, 2);
  assert.deepEqual(meta.delay, [80, 160]);
  const first = await sharp(result, { page: 0, pages: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  const second = await sharp(result, { page: 1, pages: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.notDeepEqual(first, second);
});

test("bounds output size and handles very wide, tall, and tiny sources", async () => {
  for (const [width, height, columns, rows] of [
    [2048, 1024, 4, 2],
    [4000, 16, 16, 16],
    [16, 4000, 16, 16],
    [1, 1, 1, 1],
  ]) {
    const output = await make67Sticker(
      await solid(width!, height!),
      columns!,
      rows!,
    );
    const meta = await sharp(output, IMAGE_OPTIONS).metadata();
    assert.ok(meta.width >= columns!);
    assert.ok(meta.pageHeight! >= rows!);
    assert.ok(meta.width <= 1024 && meta.pageHeight! <= 1024);
    assert.ok(meta.width * meta.height <= IMAGE_OPTIONS.limitInputPixels);
  }
});

test("rejects unsupported images, oversized grids, and excessive frames before rendering", async () => {
  await assert.rejects(
    make67Sticker(await solid(8, 8), 16, 16),
    /grid exceeds/,
  );
  await assert.rejects(make67Sticker(await solid(8, 8), 17, 1), /Invalid/);
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
  );
  await assert.rejects(make67Sticker(svg, 1, 1), /Unsupported/);
  const frames = await Promise.all(
    Array.from({ length: 51 }, (_, i) => solid(8, 8, i % 2 ? "red" : "blue")),
  );
  const animation = await sharp(frames, { join: { animated: true } })
    .gif()
    .toBuffer();
  await assert.rejects(make67Sticker(animation, 1, 1), /Unsupported/);
});
