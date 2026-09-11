import type { KnownBlock } from "@slack/types";
import { App } from "@slack/bolt";
import sharp from "sharp";

import { and, desc, eq, exists, sql } from "@repo/db";
import { db } from "@repo/db/client";
import { stickerLikes, stickers } from "@repo/db/schema";

import { env } from "./env";
import {
  downloadSlackImage,
  IMAGE_OPTIONS,
  validDimensions,
  validateImageMetadata,
} from "./security.ts";
import {
  createSticker,
  deleteEmojis,
  formatSticker,
  isImageFile,
  recommendedStickerDimensions,
} from "./utils";


function stickerFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const proxyStatus = /^Emoji proxy rejected (upload|remove) \(HTTP (\d{3})\)$/.exec(message);
  if (proxyStatus) return `Emoji proxy returned HTTP ${proxyStatus[2]}.`;
  const safeMessages = new Set([
    "Invalid emoji proxy URL",
    "Emoji proxy request failed; check proxy activity before retrying",
    "Emoji exceeds the proxy's 128 KiB limit",
    "Invalid sticker name or dimensions",
    "Sticker grid exceeds image dimensions",
    "Untrusted Slack file URL",
    "Could not download Slack image",
    "Image exceeds 10 MiB",
    "Unsupported image or image exceeds pixel/frame limits",
  ]);
  if (safeMessages.has(message)) return message;
  // Only explicitly known Slack error codes are safe to expose.
  const code = (error as { data?: { error?: unknown } } | null)?.data?.error;
  if (typeof code === "string" && [
    "missing_scope", "not_authed", "invalid_auth", "token_revoked",
    "not_in_channel", "channel_not_found", "already_reacted", "ratelimited",
    "cant_delete_message", "message_not_found",
  ].includes(code)) return `Slack API: ${code}.`;
  return "The operation failed; the cause could not be classified safely.";
}

const reservedTitles = new Set(); // when the button is clicked to start creating a sticker, it is added here, to prevent duplication

const ALLOWED_CHANNELS = env.PUBLIC_SLACK_CHANNELS.split(",") // split comma-separated list
  .map((x) => x.trim()); // trim whitespace

const SEARCH_RESULT_LIMIT = 5;
const BROWSE_SECTION_RESULT_LIMIT = 3;
const SEARCH_QUERY_MAX_LENGTH = 80;
const SEARCH_ACTION_ID = "sticker_search_select";

type Sticker = typeof stickers.$inferSelect;

function normalizeSearchQuery(query: string) {
  return query
    .trim()
    .toLowerCase()
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ");
}

function stickerPreviewBlocks(sticker: Sticker): KnownBlock[] {
  const rows = formatSticker(sticker.emojis, sticker.width)
    .trimEnd()
    .split("\n");
  const chunks: string[] = [];
  let chunk = "";

  for (const row of rows) {
    const nextChunk = chunk ? `${chunk}\n${row}` : row;
    if (nextChunk.length <= 2800) {
      chunk = nextChunk;
      continue;
    }

    if (chunk) chunks.push(chunk);
    chunk = row;
  }

  if (chunk) chunks.push(chunk);

  return chunks.map((text) => ({
    type: "section",
    text: { type: "mrkdwn", text },
  }));
}

function appendStickerResultBlocks({
  blocks,
  results,
  previewAll,
  primaryFirst = false,
}: {
  blocks: KnownBlock[];
  results: Sticker[];
  previewAll: boolean;
  primaryFirst?: boolean;
}) {
  results.forEach((sticker, index) => {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${sticker.title}*\n${sticker.width}×${sticker.height} • created by <@${sticker.creator}>`,
      },
      accessory: {
        type: "button",
        action_id: SEARCH_ACTION_ID,
        value: String(sticker.id),
        text: { type: "plain_text", text: "Send sticker", emoji: true },
        style: index === 0 && primaryFirst ? "primary" : undefined,
      },
    });

    if (previewAll || index === 0) {
      blocks.push(...stickerPreviewBlocks(sticker));
    }
  });
}

function browseResultBlocks({
  likedResults,
  recentResults,
}: {
  likedResults: Sticker[];
  recentResults: Sticker[];
}): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Your sticker collection",
        emoji: true,
      },
    },
  ];

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*Your favourites*" },
  });

  if (likedResults.length > 0) {
    appendStickerResultBlocks({
      blocks,
      results: likedResults,
      previewAll: true,
    });
  } else {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "plain_text",
          text: "You haven't liked any stickers yet.",
          emoji: true,
        },
      ],
    });
  }

  blocks.push(
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Recently added*" },
    },
  );

  if (recentResults.length > 0) {
    appendStickerResultBlocks({
      blocks,
      results: recentResults,
      previewAll: true,
    });
  } else {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "plain_text",
          text: "There aren't any other recent stickers to show.",
          emoji: true,
        },
      ],
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `<${env.BASE_URL}|Browse all stickers and manage your favourites>`,
      },
    ],
  });

  return blocks;
}

function searchResultBlocks({
  query,
  results,
}: {
  query?: string;
  results: Sticker[];
}): KnownBlock[] {
  const isBrowsing = !query;

  if (results.length === 0) {
    return [
      {
        type: "header",
        text: { type: "plain_text", text: "No stickers found", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "plain_text",
          text: query
            ? `Nothing matched “${query}”. Try fewer words, check the spelling, or search for part of the name.`
            : "There aren't any stickers to browse yet.",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `You can also <${env.BASE_URL}|browse the full sticker library>.`,
          },
        ],
      },
    ];
  }

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: isBrowsing ? "Recently added stickers" : "Sticker search",
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "plain_text",
          text: isBrowsing
            ? "Choose a sticker to send to this conversation."
            : `${results.length} ${results.length === 1 ? "match" : "matches"} for “${query}” • best match first`,
          emoji: true,
        },
      ],
    },
  ];

  appendStickerResultBlocks({
    blocks,
    results,
    previewAll: isBrowsing,
    primaryFirst: !isBrowsing,
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `<${env.BASE_URL}|Browse the full library> • Run \`/sticker\` with no search to see recent additions.`,
      },
    ],
  });

  return blocks;
}

export const app = new App({
  socketMode: true,
  token: env.SLACK_BOT_TOKEN,
  appToken: env.SLACK_APP_TOKEN,
});

app.message(async ({ client, message }) => {
  if (
    message.subtype !== "file_share" ||
    !ALLOWED_CHANNELS.includes(message.channel) ||
    !message.files
  ) {
    return; // probably someone just chatting
  }

  if (message.files.length !== 1) {
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: "you must have exactly one image file in your message! no more, no less!",
    });
    return;
  }

  if (
    !message.text ||
    message.text.length < 1 ||
    message.text
      .split("")
      .filter((x) => !"abcdefghijklmnopqrstuvwxyz1234567890-_".includes(x))
      .length !== 0
  ) {
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: "your message text is the name of your sticker! it must be fully lowercase and have no punctuation!",
    });
    return;
  }

  if (message.text.length > 50) {
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: "your sticker name is too long! please make it shorter (less than or equal to 50 chars)",
    });
    return;
  }

  const file = message.files[0];
  if (!file) return; // it should exist

  if (!isImageFile(file.mimetype)) {
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: `your file must be a supported image type! (either png, jpeg, gif, or webp) (your file was ${file.mimetype})`,
    });
    return;
  }

  const imageMeta = await sharp(
    await downloadSlackImage(file.url_private!, env.SLACK_BOT_TOKEN),
    IMAGE_OPTIONS,
  ).metadata();

  if (imageMeta.pages && imageMeta.pages > 50) {
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: `your animated image can have a maximum of 50 frames! (currently it has ${imageMeta.pages} frames)`,
    });
    return;
  }

  validateImageMetadata(imageMeta);

  const recommended = recommendedStickerDimensions(
    imageMeta.width,
    imageMeta.pageHeight || imageMeta.height,
  );

  await client.chat.postMessage({
    channel: message.channel,
    thread_ts: message.ts,
    text: "Your client cannot display this message, please open this message fully!",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Choose the size of the sticker below!",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              emoji: true,
              text: `Recommended (${recommended[0]}x${recommended[1]})`,
            },
            style: "primary",
            value: `${recommended[0]}x${recommended[1]}`,
            action_id: `${recommended[0]}x${recommended[1]}`,
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              emoji: true,
              text: "2x2",
            },
            value: "2x2",
            action_id: "2x2",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              emoji: true,
              text: "3x3",
            },
            value: "3x3",
            action_id: "3x3",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              emoji: true,
              text: "4x4",
            },
            value: "4x4",
            action_id: "4x4",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              emoji: true,
              text: "Custom",
            },
            value: "Custom",
            action_id: "custom",
          },
        ],
      },
    ],
  });
});

app.action("custom", async ({ client, action, body, ack }) => {
  await ack();
  if (
    action.type !== "button" ||
    !action.value ||
    body.type !== "block_actions" ||
    !body.actions[0] ||
    !body.channel ||
    !body.message ||
    !body.message.thread_ts ||
    !ALLOWED_CHANNELS.includes(body.channel.id)
  )
    return;

  const message = (
    await client.conversations.history({
      channel: body.channel.id,
      latest: body.message.thread_ts, // it exists!
      inclusive: true,
      limit: 1,
    })
  )?.messages?.[0];

  if (!message) throw new Error("message not found!");

  if (message.user !== body.user.id) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      thread_ts: message.ts,
      user: body.user.id,
      text: `you don't have permission to click that button!!`,
    });
    return;
  }

  const title = message.text;
  if (!title) return;

  await client.chat.delete({
    channel: body.channel.id,
    ts: body.message.ts,
  });

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      // View identifier
      callback_id: "custom_dimensions",
      title: {
        type: "plain_text",
        text: "Sticker Dimensions",
      },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Please select the width and height of the sticker",
          },
        },
        {
          type: "input",
          block_id: "width",
          label: {
            type: "plain_text",
            text: "Width of the sticker:",
          },
          element: {
            type: "number_input",
            action_id: "width",
            min_value: "1",
            max_value: "16",
            is_decimal_allowed: false,
          },
        },
        {
          type: "input",
          block_id: "height",
          label: {
            type: "plain_text",
            text: "Height of the sticker:",
          },
          element: {
            type: "number_input",
            action_id: "height",
            min_value: "1",
            max_value: "16",
            is_decimal_allowed: false,
          },
        },
      ],
      submit: {
        type: "plain_text",
        text: "Create",
      },
      private_metadata: body.channel.id + ";;" + message.ts,
    },
  });
});

app.view("custom_dimensions", async ({ client, body, view, ack }) => {
  await ack();
  if (body.type !== "view_submission") return;
  const width = Number(view.state.values.width?.width?.value);
  const height = Number(view.state.values.height?.height?.value);
  if (!validDimensions(width, height)) return;

  const [channelId, messageTs] = view.private_metadata.split(";;");
  if (!channelId || !messageTs || !ALLOWED_CHANNELS.includes(channelId)) return;

  const message = (
    await client.conversations.history({
      channel: channelId,
      latest: messageTs,
      inclusive: true,
      limit: 1,
    })
  )?.messages?.[0];

  if (!message || !message.user) throw new Error("message not found!");

  if (message.user !== body.user.id) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: message.ts,
      user: body.user.id,
      text: `you don't have permission to click that button!!`,
    });
    return;
  }

  const file = message.files![0]!;

  const title = message.text;
  if (!title) return;

  console.log(reservedTitles);

  if (
    reservedTitles.has(title) ||
    (await db.select().from(stickers).where(eq(stickers.title, title)))
      .length !== 0
  ) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: message.ts,
      text: "a sticker with the same name already exists!",
    });
    return;
  }

  if (reservedTitles.size >= 2 || reservedTitles.has(title)) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: body.user.id,
      text: "The bot is busy creating stickers. Please try again shortly.",
    });
    return;
  }
  reservedTitles.add(title);
  try {
    // This reaction is supposed to show that the sticker is being processed
    await client.reactions.add({
      channel: channelId,
      name: "thinking_face",
      timestamp: message.ts!,
    });

    console.log("creating sticker '", title, "' for", message.user);

    const emojis = await createSticker({
      fileUrl: file.url_private!,
      title: title,
      width: width,
      height: height,
      channel: channelId,
      timestamp: message.ts!,
      app: app,
    });

    try {
      await client.reactions.remove({
        channel: channelId,
        name: "thinking_face",
        timestamp: message.ts!,
      });
    } catch {}

    const stickerMessage = await client.chat.postMessage({
      channel: channelId,
      thread_ts: message.ts,
      text: formatSticker(emojis, width),
    });

    if (!stickerMessage.ok) throw Error("Couldn't send sticker message");
    if (!stickerMessage.ts)
      throw Error("Couldn't get timestamp of sticker message");

    const permalink = (
      await client.chat.getPermalink({
        channel: channelId,
        message_ts: stickerMessage.ts,
      })
    ).permalink;
    if (!permalink) throw Error("Couldn't get permalink");

    try {
      await db.insert(stickers).values({
        title: title,
        creator: message.user,
        emojis: emojis,
        width: width,
        height: height,
        slackPermalink: permalink,
      });
    } catch (error) {
      console.error("error saving sticker:", error);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: message.ts,
        text: "oops! there was an error saving your sticker to the database! please try again if you need it to be saved!",
      });
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: message.ts,
      text: `<@${message.user}> Done!`,
    });

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: message.ts,
      text: `P.S. You can access this sticker and many more on the website at ${env.BASE_URL}\nTo delete this sticker, run: /delete-sticker ${title}`,
    });
  } catch (error) {
    const reason = stickerFailureReason(error);
    app.logger.error("Sticker creation failed", { reason });
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: message.ts,
      text: `Sticker creation failed: ${reason} Please contact the operator before retrying; some emoji may already have been uploaded.`,
    });
  } finally {
    reservedTitles.delete(title);
  }
});

// Regex matches `{digit}x{digit}`
app.action(/^\d{1,2}x\d{1,2}$/, async ({ client, action, body, ack }) => {
  await ack();

  if (
    action.type !== "button" ||
    !action.value ||
    body.type !== "block_actions" ||
    !body.actions[0] ||
    !body.channel ||
    !body.message ||
    !body.message.thread_ts ||
    !ALLOWED_CHANNELS.includes(body.channel.id)
  )
    return;

  const [width, height] = body.actions[0].action_id.split("x").map(Number);
  if (!width || !height || !validDimensions(width, height)) return;

  const message = (
    await client.conversations.history({
      channel: body.channel.id,
      latest: body.message.thread_ts, // it exists!
      inclusive: true,
      limit: 1,
    })
  )?.messages?.[0];

  if (!message || !message.user) throw new Error("message not found!");

  if (message.user !== body.user.id) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      thread_ts: message.ts,
      user: body.user.id,
      text: `you don't have permission to click that button!!`,
    });
    return;
  }

  const file = message.files![0]!;

  const title = message.text;
  if (!title) return;

  if (
    reservedTitles.has(title) ||
    (await db.select().from(stickers).where(eq(stickers.title, title)))
      .length !== 0
  ) {
    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: message.ts,
      text: "a sticker with the same name already exists!",
    });
    return;
  }

  if (reservedTitles.size >= 2 || reservedTitles.has(title)) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: "The bot is busy creating stickers. Please try again shortly.",
    });
    return;
  }
  reservedTitles.add(title);
  try {
    await client.chat.delete({
      channel: body.channel.id,
      ts: body.message.ts,
    });

    // This reaction is supposed to show that the sticker is being processed
    await client.reactions.add({
      channel: body.channel.id,
      name: "thinking_face",
      timestamp: message.ts!,
    });

    console.log("creating sticker '", title, "' for", message.user);

    const emojis = await createSticker({
      fileUrl: file.url_private!,
      title: title,
      width: width,
      height: height,
      channel: body.channel.id,
      timestamp: message.ts!,
      app: app,
    });

    try {
      await client.reactions.remove({
        channel: body.channel.id,
        name: "thinking_face",
        timestamp: message.ts!,
      });
    } catch {}

    const stickerMessage = await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: message.ts,
      text: formatSticker(emojis, width),
    });

    if (!stickerMessage.ok) throw Error("Couldn't send sticker message");
    if (!stickerMessage.ts)
      throw Error("Couldn't get timestamp of sticker message");

    const permalink = (
      await client.chat.getPermalink({
        channel: body.channel.id,
        message_ts: stickerMessage.ts,
      })
    ).permalink;
    if (!permalink) throw Error("Couldn't get permalink");

    try {
      await db.insert(stickers).values({
        title: title,
        creator: message.user,
        emojis: emojis,
        width: width,
        height: height,
        slackPermalink: permalink,
      });
    } catch (error) {
      console.error("error saving sticker:", error);
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: message.ts,
        text: "oops! there was an error saving your sticker to the database! please try again if you need it to be saved!",
      });
    }

    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: message.ts,
      text: `<@${message.user}> Done!`,
    });

    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: message.ts,
      text: `P.S. You can access this sticker and many more on the website at ${env.BASE_URL}\nTo delete this sticker, run: /delete-sticker ${title}`,
    });
  } catch (error) {
    const reason = stickerFailureReason(error);
    app.logger.error("Sticker creation failed", { reason });
    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: message.ts,
      text: `Sticker creation failed: ${reason} Please contact the operator before retrying; some emoji may already have been uploaded.`,
    });
  } finally {
    reservedTitles.delete(title);
  }
});

// it's a regex to allow for other names like `sticker-dev` to work
// because slack only allows one app to use a sticker name but you may need to have a separate development app
app.command(/\/sticker.*/, async ({ command, ack, respond }) => {
  await ack();

  const rawQuery = command.text.trim();

  if (rawQuery.length > SEARCH_QUERY_MAX_LENGTH) {
    await respond({
      response_type: "ephemeral",
      text: "That search is a little too long.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*That search is a little too long.*\nKeep it under ${SEARCH_QUERY_MAX_LENGTH} characters and try again.`,
          },
        },
      ],
    });
    return;
  }

  const stickerQuery = normalizeSearchQuery(rawQuery);
  let results: Sticker[];
  let likedResults: Sticker[] = [];

  if (!stickerQuery) {
    const [userLikes, recentCandidates] = await Promise.all([
      db.query.stickers.findMany({
        where: exists(
          db
            .select()
            .from(stickerLikes)
            .where(
              and(
                eq(stickerLikes.stickerId, stickers.id),
                eq(stickerLikes.userId, command.user_id),
              ),
            ),
        ),
        orderBy: desc(stickers.createdAt),
        limit: BROWSE_SECTION_RESULT_LIMIT,
      }),
      db
        .select()
        .from(stickers)
        .orderBy(desc(stickers.createdAt))
        .limit(BROWSE_SECTION_RESULT_LIMIT * 2),
    ]);

    likedResults = userLikes;
    const likedStickerIds = new Set(userLikes.map((sticker) => sticker.id));
    results = recentCandidates
      .filter((sticker) => !likedStickerIds.has(sticker.id))
      .slice(0, BROWSE_SECTION_RESULT_LIMIT);
  } else {
    // treat common name separators as spaces
    const normalizedTitle = sql<string>`regexp_replace(${stickers.title}, '[-_+]+', ' ', 'g')`;
    const distance = sql<number>`levenshtein(${normalizedTitle}, ${stickerQuery})`;
    const fuzzyLimit = Math.min(
      4,
      Math.max(1, Math.floor(stickerQuery.length / 4)),
    );
    const terms = stickerQuery.split(" ").slice(0, 8);
    const containsEveryTerm = sql.join(
      terms.map((term) => sql`position(${term} in ${normalizedTitle}) > 0`),
      sql` and `,
    );

    results = await db
      .select()
      .from(stickers)
      .where(
        sql`(${containsEveryTerm}) or levenshtein_less_equal(${normalizedTitle}, ${stickerQuery}, ${fuzzyLimit}) <= ${fuzzyLimit}`,
      )
      .orderBy(
        sql`case
          when ${normalizedTitle} = ${stickerQuery} then 0
          when position(${stickerQuery} in ${normalizedTitle}) = 1 then 1
          when position(${stickerQuery} in ${normalizedTitle}) > 1 then 2
          else 3
        end`,
        distance,
        stickers.title,
      )
      .limit(SEARCH_RESULT_LIMIT);
  }

  await respond({
    response_type: "ephemeral",
    text: stickerQuery
      ? `${results.length} sticker search results for ${rawQuery}`
      : "Your favourite and recently added stickers",
    blocks: stickerQuery
      ? searchResultBlocks({ query: rawQuery, results })
      : browseResultBlocks({ likedResults, recentResults: results }),
  });
});

app.action(SEARCH_ACTION_ID, async ({ action, ack, body, client, respond }) => {
  await ack();

  if (action.type !== "button" || !body.channel?.id) return;

  const stickerId = Number(action.value);
  if (!Number.isSafeInteger(stickerId)) return;

  const sticker = await db.query.stickers.findFirst({
    where: eq(stickers.id, stickerId),
  });

  if (!sticker) {
    await respond({
      replace_original: true,
      response_type: "ephemeral",
      text: "That sticker is no longer available.",
    });
    return;
  }

  try {
    await client.chat.postMessage({
      channel: body.channel.id,
      text: `${formatSticker(sticker.emojis, sticker.width)}_Requested by <@${body.user.id}>_`,
    });
  } catch (error) {
    app.logger.error("Couldn't send sticker from search", error);
    await respond({
      replace_original: true,
      response_type: "ephemeral",
      text: `I couldn't send "${sticker.title}". Please try again.`,
    });
    return;
  }

  await respond({
    replace_original: true,
    response_type: "ephemeral",
    text: `Sent “${sticker.title}” to the conversation.`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: Sent *${sticker.title}* to the conversation.`,
        },
      },
    ],
  });
});

app.command(/\/delete-sticker.*/, async ({ command, ack, respond }) => {
  await ack();

  const stickerTitle = command.text.trim().toLowerCase();

  const sticker = await db.query.stickers.findFirst({
    where: eq(stickers.title, stickerTitle),
  });

  if (!sticker) return await respond("I couldn't find that sticker.");

  if (sticker.creator !== command.user_id)
    return await respond("You didn't create that sticker.");

  await respond("I'm deleting the sticker now.");

  try {
    await deleteEmojis({ emojis: sticker.emojis });
  } catch {
    await respond(
      "Deletion could not be completed. The sticker record has been kept. Older emoji may need proxy ownership backfill; contact the operator.",
    );
    return;
  }

  await db.delete(stickers).where(eq(stickers.title, stickerTitle));

  await respond("The sticker has been deleted!");
});

await app.start();
app.logger.info("StickerBot has started!!");
