FROM oven/bun:1.4.2
WORKDIR /usr/src/app

COPY . .
RUN bun install --frozen-lockfile

USER bun
ENTRYPOINT [ "bun", "run", "./apps/bot/src/index.ts" ]

