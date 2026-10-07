<script lang="ts">
  import StickerList from "#lib/components/StickerList.svelte";
  import { Input } from "#lib/components/ui/input/index.ts";

  let search = $state("");
</script>

<h1 class="text-3xl font-semibold">Sticker Gallery</h1>
<p>List of stickers (newest first)</p>

<Input
  bind:value={search}
  type="text"
  placeholder="Search..."
  class="w-full my-4 bg-white"
/>

<StickerList bind:search />
