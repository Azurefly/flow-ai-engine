FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

ARG BUILD_ID=not-injected
ARG BUILD_TIME=not-injected
ENV BUILD_ID=${BUILD_ID}
ENV BUILD_TIME=${BUILD_TIME}

COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

ARG BUILD_ID=not-injected
ARG BUILD_TIME=not-injected
ENV NODE_ENV=production
ENV PORT=3000
ENV BUILD_ID=${BUILD_ID}
ENV BUILD_TIME=${BUILD_TIME}
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/scripts/remote-deployment-acceptance.mjs ./scripts/remote-deployment-acceptance.mjs

USER node
EXPOSE 3000

CMD ["sh", "-c", "./node_modules/.bin/drizzle-kit migrate && node dist/index.js"]
