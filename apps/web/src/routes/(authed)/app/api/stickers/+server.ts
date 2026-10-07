import { error } from "@sveltejs/kit";
import { assertUserExists } from "#lib/server/assertion.ts";

import { and, desc, eq, exists, lt, sql } from "@repo/db";
import { db } from "@repo/db/client";
import { stickerLikes, stickers } from "@repo/db/schema";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
  assertUserExists(locals.auth);
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (query.length > 80) error(400, "Search is too long");
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? undefined : Number(rawCursor);
  if (
    cursor !== undefined &&
    (!Number.isSafeInteger(cursor) || cursor < 1 || cursor > 2147483647)
  )
    error(400, "Invalid cursor");
  const likedByMe = exists(
    db
      .select()
      .from(stickerLikes)
      .where(
        and(
          eq(stickerLikes.stickerId, stickers.id),
          eq(stickerLikes.userId, locals.auth.user),
        ),
      ),
  );
  const rows = await db
    .select({
      id: stickers.id,
      title: stickers.title,
      createdAt: stickers.createdAt,
      creator: stickers.creator,
      width: stickers.width,
      height: stickers.height,
      emojis: stickers.emojis,
      slackPermalink: stickers.slackPermalink,
      likedByMe: sql<boolean>`${likedByMe}`,
    })
    .from(stickers)
    .where(
      and(
        cursor === undefined ? undefined : lt(stickers.id, cursor),
        url.searchParams.get("liked") === "true" ? likedByMe : undefined,
        query
          ? sql`position(${query} in lower(${stickers.title})) > 0`
          : undefined,
      ),
    )
    .orderBy(desc(stickers.id))
    .limit(15);
  return Response.json(rows);
};

export type Sticker = typeof stickers.$inferSelect & { likedByMe: boolean };
