import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const stickers = pgTable("stickers", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  title: varchar({ length: 255 }).notNull().unique(),
  createdAt: timestamp().defaultNow().notNull(),
  creator: varchar({ length: 255 }).notNull(), // the Slack ID of the creator
  width: integer().notNull(),
  height: integer().notNull(),
  emojis: jsonb().$type<string[]>().notNull(),
  slackPermalink: text().notNull(),
});

export const stickerLikes = pgTable(
  "sticker_likes",
  {
    id: serial("id").primaryKey(),
    stickerId: integer("sticker_id")
      .notNull()
      .references(() => stickers.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 }).notNull(), // the Slack ID of the user who liked the sticker
  },
  (t) => [unique().on(t.stickerId, t.userId)],
);

export const stickersRelations = relations(stickers, ({ many }) => ({
  stickerLikes: many(stickerLikes),
}));

export const stickerLikesRelations = relations(stickerLikes, ({ one }) => ({
  sticker: one(stickers, {
    fields: [stickerLikes.stickerId],
    references: [stickers.id],
  }),
}));

export const authAttempt = pgTable("auth_attempt", {
  state: serial("id").primaryKey(),
  nonce: uuid("nonce").defaultRandom().notNull(),
  redirectUri: text("redirect_uri").notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    name: text().notNull(),
    image: text(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expiry_idx").on(t.expiresAt),
  ],
);

// Durable title reservation, upload progress, and uncertain upstream outcomes.
export const stickerJobs = pgTable("sticker_jobs", {
  title: varchar({ length: 255 }).primaryKey(),
  creator: varchar({ length: 255 }).notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
  emojis: jsonb().$type<string[]>().notNull().default([]),
  pendingEmoji: text("pending_emoji"),
  status: text().$type<"processing" | "failed" | "deleting">().notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
});
