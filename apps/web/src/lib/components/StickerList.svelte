<script lang="ts">
  import { onMount } from "svelte";
  import { Loader } from "@lucide/svelte";
  import StickerCard from "#lib/components/StickerCard.svelte";

  import type { Sticker } from "../../routes/(authed)/app/api/stickers/+server";

  let stickers: Sticker[] = $state([]);
  let loading = $state(false);
  let hasMore = $state(true);
  let failure = $state("");
  let {
    likedOnly = false,
    search = $bindable(),
  }: { likedOnly?: boolean; search?: string } = $props();
  let intersectionCanary: HTMLDivElement;
  let controller = new AbortController();
  let mounted = $state(false);

  $effect(() => {
    const query = search;
    const liked = likedOnly;
    if (!mounted) return;
    controller.abort();
    controller = new AbortController();
    stickers = [];
    loading = false;
    hasMore = true;
    failure = "";
    const timer = setTimeout(
      () => {
        void loadMore();
      },
      query ? 250 : 0,
    );
    return () => clearTimeout(timer);
  });

  async function loadMore() {
    if (loading || !hasMore || controller.signal.aborted) return;
    loading = true;
    failure = "";
    const signal = controller.signal;
    try {
      const params = new URLSearchParams({
        liked: String(likedOnly),
        q: search?.trim() ?? "",
      });
      const cursor = stickers.at(-1)?.id;
      if (cursor) params.set("cursor", String(cursor));
      const response = await fetch(`/app/api/stickers?${params}`, { signal });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "Please sign in again."
            : "Could not load stickers. Please retry.",
        );
      const next = (await response.json()) as Sticker[];
      if (signal.aborted) return;
      const known = new Set(stickers.map((sticker) => sticker.id));
      stickers.push(...next.filter((sticker) => !known.has(sticker.id)));
      hasMore = next.length === 15;
    } catch (error) {
      if (!signal.aborted)
        failure =
          error instanceof Error ? error.message : "Could not load stickers.";
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  onMount(() => {
    const observer = new IntersectionObserver((entries) => {
      if (!failure && entries.some((entry) => entry.isIntersecting))
        void loadMore();
    });
    observer.observe(intersectionCanary);
    mounted = true;
    return () => {
      mounted = false;
      observer.disconnect();
      controller.abort();
    };
  });
</script>

<div class="columns-1 md:columns-2 xl:columns-3 gap-3 *:mb-3">
  {#each stickers as sticker (sticker.id)}
    {#if !likedOnly || sticker.likedByMe}
      <StickerCard {sticker} />
    {/if}
  {:else}
    {#if !loading && !failure}
      <p>No stickers yet!</p>
    {/if}
  {/each}
</div>
<div
  bind:this={intersectionCanary}
  class="min-h-6 flex flex-col items-center gap-2"
>
  {#if loading}<Loader class="animate-spin" />{/if}
  {#if failure}<p role="alert">{failure}</p>{/if}
  {#if hasMore && !loading}<button class="underline" onclick={loadMore}
      >{failure ? "Retry" : "Load more"}</button
    >{/if}
</div>
