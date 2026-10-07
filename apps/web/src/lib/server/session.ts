import { createHash, randomBytes } from "node:crypto";
import type { JWTData } from "#lib/types.ts";

import { and, eq, gt, lte } from "@repo/db";
import { db } from "@repo/db/client";
import { sessions } from "@repo/db/schema";

export const SESSION_SECONDS = 2 * 24 * 60 * 60;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function createSession(user: JWTData) {
  const token = randomBytes(32).toString("hex");
  await db.delete(sessions).where(lte(sessions.expiresAt, new Date()));
  await db.insert(sessions).values({
    tokenHash: digest(token),
    userId: user.user,
    name: user.name,
    image: user.image,
    expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
  });
  return token;
}

export async function readSession(token: string): Promise<JWTData | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.tokenHash, digest(token)),
      gt(sessions.expiresAt, new Date()),
    ),
  });
  return session
    ? { user: session.userId, name: session.name, image: session.image }
    : null;
}

export async function revokeSession(token: string) {
  if (/^[a-f0-9]{64}$/.test(token))
    await db.delete(sessions).where(eq(sessions.tokenHash, digest(token)));
}
