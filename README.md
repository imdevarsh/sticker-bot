# sticker-bot

![Hackatime badge](https://hackatime-badge.hackclub.com/U079QLTJZ7H/sticker-bot)

[Demo](https://sticker-bot.devarsh.me)

A Slack bot that lets you make large emoji images! (I call them stickers, like stickers in other communication apps)

**Inspired by [emojibot](https://github.com/taciturnaxolotl/emojibot)!**

The bot (`apps/bot`) uses [Slack Bolt (JS)](https://api.slack.com/bolt) and the website (`apps/web`) uses [SvelteKit](https://svelte.dev/docs/kit/introduction). [Turborepo](https://turborepo.com) is used as well.

## Setup

You will need [Bun](https://bun.sh) to run this bot. Also, for data storage, you will need a [Neon](https://neon.tech) database.

To set up the `.env` file:

```bash
cp .env.example .env
$EDITOR .env # add the requested environment variables! you can use the slack-manifest.json for assistance creating the Slack app
```

To install dependencies:

```bash
bun install --frozen-lockfile
```

To develop:

```bash
bun run dev
```

To deploy this project, you will need to deploy both the bot and the website.

### Database and security upgrade

Before starting the updated bot and website, apply the schema:

```bash
bun run db:push
bun run db:upgrade
```

For an existing installation with the sticker tables already present, `db:upgrade`
is sufficient. It adds session and job tables, installs the search extension, and
clears obsolete login attempts. The commands use `DATABASE_URL` from `.env` and
are safe to repeat. Deploy the bot and website together after the migration;
existing website users will sign in again.

Update the Slack app from `slack-manifest.json` and reinstall it to grant
`users:read` and subscribe to `user_change`. The bot revokes website sessions
when a Slack member is deactivated. Logout also revokes the session in the
database. Run one bot worker per workspace so its resource limits apply globally.

Image previews allow two simultaneous jobs and five requests per user per minute.
Sticker creation allows two simultaneous jobs and six per user per hour, with a
ten-minute deadline. A square image defaults to a 3×3 grid. Partial and uncertain
uploads are recorded in `sticker_jobs`; `/delete-sticker <name>` cleans up the
creator's failed job and resumes interrupted deletions. If the proxy cannot
confirm ownership of an uncertain upload, the bot keeps the record for operator
reconciliation instead of discarding progress or replaying the upload.

SvelteKit 3 uses TypeScript 6's compiler API, while the bot/database CLI uses
TypeScript 7. `bunfig.toml` isolates workspace dependencies to keep both versions
compatible. Use Bun 1.4.2 or later and Node 22.17 or later for web tooling.

### Deploying the Bot

To deploy the bot, use the provided `Dockerfile`. Alternatively, run:

```bash
bun run ./apps/bot/src/index.ts
```

### Deploying the Website

The website was designed to be deployed with Vercel and uses the `@sveltejs/adapter-vercel` SvelteKit adapter. If you would like to deploy with a different provider, adjust the configuration in `apps/web/vite.config.ts` and follow the instructions for your preferred adapter.
