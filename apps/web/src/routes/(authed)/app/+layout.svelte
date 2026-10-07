<script lang="ts">
  import "../../../app.css";

  import type { Snippet } from "svelte";
  import * as NavigationMenu from "#lib/components/ui/navigation-menu/index.ts";
  import { navigationMenuTriggerStyle } from "#lib/components/ui/navigation-menu/navigation-menu-trigger.svelte";
  import { Toaster } from "#lib/components/ui/sonner/index.ts";
  import { Provider } from "#lib/components/ui/tooltip/index.ts";

  import type { LayoutData } from "./$types";

  let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<svelte:head>
  <title>Sticker Bot</title>
</svelte:head>

<Toaster />

<div
  class="px-6 py-3 rounded-full border border-sky-300 flex items-center w-full"
>
  <a href="/app" class="font-semibold flex w-full">Sticker Bot</a>
  <NavigationMenu.Root viewport={false}>
    <NavigationMenu.List>
      <NavigationMenu.Item>
        <a href="/app" class={navigationMenuTriggerStyle()}>Dashboard</a>
      </NavigationMenu.Item>
      <NavigationMenu.Item>
        <a href="/app/stickers" class={navigationMenuTriggerStyle()}
          >Sticker Gallery</a
        >
      </NavigationMenu.Item>
      <NavigationMenu.Item class="flex">
        <NavigationMenu.Trigger class="px-1.5 py-3.5 mx-2.5">
          <img
            src={data.auth.image ?? undefined}
            class="rounded-full w-8 h-8 border"
            alt="Your Slack PFP"
          />
          <span class="ml-2">{data.auth.name}</span>
        </NavigationMenu.Trigger>

        <NavigationMenu.Content>
          <NavigationMenu.Link>
            <form action="/app?/logout" method="POST">
              <button type="submit">Logout</button>
            </form>
          </NavigationMenu.Link>
        </NavigationMenu.Content>
      </NavigationMenu.Item>
    </NavigationMenu.List>
  </NavigationMenu.Root>
</div>

<div class="mx-3 my-5">
  <Provider>
    {@render children()}
  </Provider>
</div>
