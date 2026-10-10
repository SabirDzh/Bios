FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# Напоминание: devDeps оставлены сознательно — `prisma` CLI нужен
# в рантайме для `migrate deploy`. Отдельный prune сломал бы миграции.
RUN chown -R node:node /app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then((r) => { if (!r.ok) process.exit(1); })"

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
