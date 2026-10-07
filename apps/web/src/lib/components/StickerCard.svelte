<script lang="ts">
  import { ClipboardCopy, ThumbsUp } from "@lucide/svelte";
  import { buttonVariants } from "#lib/components/ui/button/index.ts";
  import * as Tooltip from "#lib/components/ui/tooltip/index.ts";
  import { getURL } from "#lib/sticker-cache.ts";
  import { toast } from "svelte-sonner";

  import type { Sticker } from "../../routes/(authed)/app/api/stickers/+server";

  function copy(text: string) {
    toast.promise(navigator.clipboard.writeText(text), {
      loading: "Copying...", // this shouldn't ever show up
      success: "Copied to clipboard!",
      error: "Failed to copy to clipboard!",
    });
  }

  function toggleLike(sticker: Sticker) {
    if (liking) return;
    liking = true;
    const liked = !sticker.likedByMe;
    toast.promise(
      (async () => {
        try {
          const res = await fetch("/app/api/stickers/like", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: sticker.id,
              liked,
            }),
          });
          if (res.ok) sticker.likedByMe = liked;
          else
            throw new Error(
              "Failed to like/unlike: " + res.status + res.statusText,
            );
        } finally {
          liking = false;
        }
      })(),
      {
        loading: "Processing...",
        success: () => (sticker.likedByMe ? "Liked!" : "Removed like!"),
        error: "Failed to process action!",
      },
    );
  }

  let { sticker }: { sticker: Sticker } = $props();
  let liking = $state(false);
  let imageGrid: HTMLDivElement;
  let synchronized = false;
  function synchronizeImages() {
    if (synchronized || !imageGrid) return;
    const images = [...imageGrid.querySelectorAll("img")];
    if (
      images.length !== sticker.emojis.length ||
      images.some((image) => !image.complete || !image.naturalWidth)
    )
      return;
    synchronized = true;
    // Restart cached animations together after every tile has loaded.
    for (const image of images) {
      const src = image.src;
      image.src = "";
      image.src = src;
    }
  }
</script>

<div class="break-inside-avoid rounded-xl bg-white p-4 shadow">
  <div class="flex">
    <div class="w-full">
      <a href={sticker.slackPermalink} target="_blank" class="font-semibold"
        >{sticker.title}</a
      >
      <!-- it's passed as a string -->
      <p class="text-sm text-gray-500">
        {new Date(sticker.createdAt).toLocaleString()}
      </p>
      <p class="text-xs text-gray-400">{sticker.width}x{sticker.height}</p>
    </div>
    <div class="space-x-2 flex">
      <Tooltip.Root>
        <Tooltip.Trigger
          disabled={liking}
          class={(sticker.likedByMe ? "bg-blue-300" : "") +
            " " +
            buttonVariants({ variant: "ghost" })}
          onclick={() => toggleLike(sticker)}><ThumbsUp /></Tooltip.Trigger
        >
        <Tooltip.Content>
          {#if sticker.likedByMe}
            <p>Remove like</p>
          {:else}
            <p>Like sticker</p>
          {/if}
        </Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger
          class={buttonVariants({ variant: "ghost" })}
          onclick={() =>
            copy(
              sticker.emojis
                .map((x) => `:${x}:`)
                .map((x, i) => {
                  if ((i + 1) % sticker.width === 0) return x + "\n";
                  return x;
                })
                .join(""),
            )}><ClipboardCopy /></Tooltip.Trigger
        >
        <Tooltip.Content>
          <p>Copy Slack emojis to clipboard</p>
        </Tooltip.Content>
      </Tooltip.Root>
    </div>
  </div>

  <div
    bind:this={imageGrid}
    class="mt-3 grid w-max max-w-full"
    style={`grid-template-columns: repeat(${sticker.width}, minmax(0, 1fr));`}
  >
    {#each sticker.emojis as emoji, i}
      {#await getURL(emoji)}
        <div class="inline p-0 w-8 h-8"></div>
      {:then emojiUrl}
        <img
          class="emoji-sync inline p-0 m-0 h-8 w-8"
          src={emojiUrl}
          alt={`Emoji ${i + 1}`}
          onload={synchronizeImages}
        />
      {:catch}
        <span class="inline w-8 h-8" title="Image unavailable">?</span>
      {/await}
    {/each}
  </div>
</div>
