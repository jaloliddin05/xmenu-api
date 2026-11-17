# syntax=docker/dockerfile:1
# Production image of the API (CLAUDE.md, "Продакшен"). Targets:
#   runtime (default)  the API: node dist/main on port 4000, as the unprivileged `node` user
#   migrate            one-off: prisma migrate deploy (docker compose run --rm migrate)
# Debian (glibc) rather than Alpine: Prisma engines and bcrypt need no musl builds this way.

ARG NODE_IMAGE=node:22-bookworm-slim

# Native modules (bcrypt) fall back to a source build when no prebuilt binary fits: tools only here
FROM ${NODE_IMAGE} AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# All dependencies: the Nest CLI, TypeScript and the Prisma CLI build the app
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
# prisma/schema.prisma is committed (assembled from src/modules/*/models by `npm run generate-schema`)
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Runtime dependencies only, plus the Prisma client generated for this schema
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Migrations need the Prisma CLI (a dev dependency): the build stage already has it
FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
  PORT=4000
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Uploaded files live here (mount a volume): served at the site root, written by the API
RUN mkdir -p uploads && chown node:node uploads
VOLUME ["/app/uploads"]
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main"]
