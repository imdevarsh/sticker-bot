import assert from "node:assert/strict";
import { mock, test } from "bun:test";

test("preset and custom flows pass the selected effect and enforce ownership", async () => {
  const actions = new Map<string | RegExp, (args: any) => Promise<void>>();
  const views = new Map<string, (args: any) => Promise<void>>();
  const creations: any[] = [];
  const openedViews: any[] = [];
  let acknowledgements = 0;
  const client = {
    conversations: {
      history: async () => ({
        messages: [
          {
            user: "U_OWNER",
            text: "test-sticker",
            ts: "1.0",
            files: [{ url_private: "https://files.slack.com/test.png" }],
          },
        ],
      }),
    },
    chat: {
      delete: async () => ({}),
      postMessage: async () => ({ ok: true, ts: "2.0" }),
      postEphemeral: async () => ({}),
      getPermalink: async () => ({ permalink: "https://slack.test/message" }),
    },
    reactions: { add: async () => ({}), remove: async () => ({}) },
    views: {
      open: async (args: any) => {
        openedViews.push(args.view);
      },
    },
  };
  mock.module("@slack/bolt", () => ({
    App: class {
      client = client;
      logger = {
        info() {},
        error(...args: any[]) {
          assert.fail(JSON.stringify(args));
        },
      };
      message() {}
      command() {}
      action(id: string | RegExp, handler: (args: any) => Promise<void>) {
        actions.set(id, handler);
      }
      view(id: string, handler: (args: any) => Promise<void>) {
        views.set(id, handler);
      }
      async start() {}
    },
  }));
  mock.module("./env", () => ({ env: { PUBLIC_SLACK_CHANNELS: "C_ALLOWED" } }));
  mock.module("@repo/db", () => ({
    and() {},
    desc() {},
    eq() {},
    exists() {},
    sql() {},
  }));
  mock.module("@repo/db/client", () => ({
    db: {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      insert: () => ({ values: async () => {} }),
    },
  }));
  mock.module("@repo/db/schema", () => ({ stickers: {}, stickerLikes: {} }));
  mock.module("./utils", () => ({
    createSticker: async (options: any) => {
      creations.push(options);
      return ["test-emoji"];
    },
    deleteEmojis: async () => {},
    formatSticker: () => ":test-emoji:",
    isImageFile: () => true,
    recommendedStickerDimensions: () => [2, 2],
  }));
  await import("./index.ts");
  const ack = async () => {
    acknowledgements++;
  };
  const state = (selected: boolean) => ({
    values: {
      sticker_effect: {
        sticker_effect: {
          type: "checkboxes",
          selected_options: selected ? [{ value: "67" }] : [],
        },
      },
    },
  });
  const body = (selected: boolean, user = "U_OWNER") => ({
    type: "block_actions",
    user: { id: user },
    channel: { id: "C_ALLOWED" },
    message: { ts: "2.0", thread_ts: "1.0" },
    actions: [{ action_id: "2x2" }],
    trigger_id: "trigger",
    state: state(selected),
  });
  const preset = [...actions.entries()].find(
    ([id]) => id instanceof RegExp,
  )![1];
  const button = { type: "button", value: "2x2" };
  for (const selected of [true, false]) {
    await preset({ client, ack, action: button, body: body(selected) });
    assert.equal(creations.at(-1).sixtySeven, selected);
  }
  const legacy = body(false);
  delete (legacy as any).state;
  await preset({ client, ack, action: button, body: legacy });
  assert.equal(creations.at(-1).sixtySeven, false);
  const before = creations.length;
  await preset({ client, ack, action: button, body: body(true, "U_OTHER") });
  assert.equal(creations.length, before);

  await actions.get("custom")!({
    client,
    ack,
    action: button,
    body: body(true),
  });
  const modal = openedViews.at(-1);
  assert.equal(
    modal.blocks.find((b: any) => b.block_id === "sticker_effect").element
      .initial_options[0].value,
    "67",
  );
  for (const selected of [true, false]) {
    await views.get("custom_dimensions")!({
      client,
      ack,
      body: { type: "view_submission", user: { id: "U_OWNER" } },
      view: {
        private_metadata: modal.private_metadata,
        state: {
          values: {
            ...state(selected).values,
            width: { width: { value: "2" } },
            height: { height: { value: "3" } },
          },
        },
      },
    });
    assert.equal(creations.at(-1).sixtySeven, selected);
    assert.equal(creations.at(-1).height, 3);
  }
  await actions.get("sticker_effect")!({ ack });
  assert.equal(acknowledgements, 8);
});
