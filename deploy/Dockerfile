# syntax=docker/dockerfile:1
# Build context is the repository root: docker build -f deploy/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /workspace
RUN npm install --global corepack@latest && corepack enable

# Dependencies first, keyed on the lockfile only, so code changes reuse this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile
# Builds the inbox and overlay into packages/server/public and the server into packages/server/dist.
RUN pnpm build && mkdir -p packages/server/public
# The server bundles @squawk/shared, so its production dependencies are plain npm packages.
RUN pnpm --filter @squawk/server deploy --prod --legacy /deploy

FROM node:22-alpine
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /workspace/packages/server/dist ./dist
COPY --from=build /workspace/packages/server/drizzle ./drizzle
COPY --from=build /workspace/packages/server/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
   CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
# Migrations run inside the server before it starts listening.
CMD ["node", "dist/main.js"]
