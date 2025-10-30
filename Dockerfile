# syntax=docker/dockerfile:1

FROM oven/bun:1.1.32-alpine AS base
WORKDIR /app

COPY package.json tsconfig.json ./
COPY bun.lock ./bun.lock

RUN bun install --ci

COPY src ./src
COPY WLaddress.txt ./WLaddress.txt

RUN bun run build

FROM oven/bun:1.1.32-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/WLaddress.txt ./WLaddress.txt

EXPOSE 3000

CMD ["bun", "dist/server.js"]
