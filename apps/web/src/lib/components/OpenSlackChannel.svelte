<script lang="ts">
  import { buttonVariants } from "#lib/components/ui/button/index.ts";
  import {
    PUBLIC_SLACK_CHANNELS,
    PUBLIC_SLACK_TEAM_DOMAIN,
  } from "$app/env/public";
</script>

<a
  href={`https://${PUBLIC_SLACK_TEAM_DOMAIN}/archives/${PUBLIC_SLACK_CHANNELS.split(",")[0]}`}
  target="_blank"
  class={buttonVariants({ variant: "default" }) + " w-[256px]"}
  >Open channel in Slack</a
>
