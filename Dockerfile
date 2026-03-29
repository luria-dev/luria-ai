FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . ./
RUN if [ -d "prisma" ]; then pnpm prisma generate; fi
RUN pnpm build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
RUN mkdir -p ./prisma
COPY --from=builder /app/prisma ./prisma 2>/dev/null || true

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
