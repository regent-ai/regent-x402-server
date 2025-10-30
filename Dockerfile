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

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS builder
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM base AS runner
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
