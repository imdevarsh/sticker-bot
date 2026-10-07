import { and, eq, lt, or } from "@repo/db";
import { db } from "@repo/db/client";
import { stickerJobs, stickers } from "@repo/db/schema";

const leaseUntil = () => new Date(Date.now() + 15 * 60_000);
const ownedJob = (title: string, creator: string) =>
  and(eq(stickerJobs.title, title), eq(stickerJobs.creator, creator));

export async function reserveCreation(
  title: string,
  creator: string,
  width: number,
  height: number,
) {
  const [job] = await db
    .insert(stickerJobs)
    .values({
      title,
      creator,
      width,
      height,
      status: "processing",
      leaseUntil: leaseUntil(),
    })
    .onConflictDoNothing()
    .returning();
  if (!job) return false;
  const existing = await db.query.stickers.findFirst({
    where: eq(stickers.title, title),
  });
  if (existing) {
    await db.delete(stickerJobs).where(ownedJob(title, creator));
    return false;
  }
  return true;
}

export async function recordPending(
  title: string,
  creator: string,
  name: string,
) {
  await db
    .update(stickerJobs)
    .set({ pendingEmoji: name })
    .where(ownedJob(title, creator));
}

export async function recordUploaded(
  title: string,
  creator: string,
  emojis: string[],
) {
  await db
    .update(stickerJobs)
    .set({ emojis: [...emojis], pendingEmoji: null })
    .where(ownedJob(title, creator));
}

export async function markJobFailed(title: string, creator: string) {
  await db
    .update(stickerJobs)
    .set({ status: "failed", leaseUntil: new Date() })
    .where(ownedJob(title, creator));
}

export async function finishCreation(sticker: typeof stickers.$inferInsert) {
  await db.insert(stickers).values(sticker);
  await db.delete(stickerJobs).where(ownedJob(sticker.title, sticker.creator));
}

export async function claimDeletion(title: string, creator: string) {
  const sticker = await db.query.stickers.findFirst({
    where: eq(stickers.title, title),
  });
  const job = await db.query.stickerJobs.findFirst({
    where: eq(stickerJobs.title, title),
  });
  if (!sticker && !job) throw new Error("Sticker not found");
  if (
    (sticker && sticker.creator !== creator) ||
    (job && job.creator !== creator)
  )
    throw new Error("You didn't create that sticker");
  const source = sticker ?? job!;
  const [claimed] = await db
    .insert(stickerJobs)
    .values({
      title,
      creator,
      width: source.width,
      height: source.height,
      emojis: source.emojis,
      status: "deleting",
      leaseUntil: leaseUntil(),
    })
    .onConflictDoUpdate({
      target: stickerJobs.title,
      set: { status: "deleting", leaseUntil: leaseUntil() },
      setWhere: and(
        eq(stickerJobs.creator, creator),
        or(
          eq(stickerJobs.status, "failed"),
          lt(stickerJobs.leaseUntil, new Date()),
        ),
      ),
    })
    .returning();
  if (!claimed) throw new Error("Sticker is already being processed");
  return { sticker, job: claimed };
}

export async function recordDeleted(
  title: string,
  creator: string,
  remaining: string[],
  pendingEmoji: string | null,
) {
  await db
    .update(stickerJobs)
    .set({ emojis: [...remaining], pendingEmoji })
    .where(ownedJob(title, creator));
}

export async function finishDeletion(
  title: string,
  creator: string,
  id?: number,
) {
  if (id !== undefined)
    await db
      .delete(stickers)
      .where(and(eq(stickers.id, id), eq(stickers.creator, creator)));
  await db.delete(stickerJobs).where(ownedJob(title, creator));
}
