import { error } from "@sveltejs/kit";
import { assertUserExists } from "#lib/server/assertion.ts";
import { readSmallJSON } from "#lib/server/request.ts";

import { and, eq } from "@repo/db";
import { db } from "@repo/db/client";
import { stickerLikes, stickers } from "@repo/db/schema";

import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ url, locals, request }) => {
  assertUserExists(locals.auth);

  if (request.headers.get("origin") !== url.origin)
    error(403, "Invalid origin");
  const req = await readSmallJSON(request);
  if (
    !req ||
    typeof req !== "object" ||
    !("liked" in req) ||
    typeof req.liked !== "boolean" ||
    !("id" in req) ||
    !Number.isSafeInteger(req.id) ||
    Number(req.id) < 1 ||
    Number(req.id) > 2147483647
  )
    error(400, "Invalid request");
  const newLiked = req.liked;
  const stickerId = Number(req.id);

  const userId = locals.auth.user;

  if (newLiked) {
    const sticker = await db.query.stickers.findFirst({
      where: eq(stickers.id, stickerId),
      columns: { id: true },
    });
    if (!sticker) error(404, "Sticker not found");
    await db
      .insert(stickerLikes)
      .values({ stickerId, userId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(stickerLikes)
      .where(
        and(
          eq(stickerLikes.stickerId, stickerId),
          eq(stickerLikes.userId, userId),
        ),
      );
  }

  return Response.json({
    success: true,
  });
};
