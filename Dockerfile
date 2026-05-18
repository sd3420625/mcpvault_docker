# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-bookworm-slim
ARG SUPERGATEWAY_VERSION=3.4.3

FROM node:${NODE_VERSION} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json server.ts ./
COPY src ./src
RUN npm run build

FROM node:${NODE_VERSION} AS runtime
ARG SUPERGATEWAY_VERSION

ENV NODE_ENV=production \
    VAULT_PATH=/vault \
    PORT=8000 \
    MCP_PATH=/mcp \
    SESSION_TIMEOUT=60000 \
    LOG_LEVEL=info

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm install -g "supergateway@${SUPERGATEWAY_VERSION}" \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /usr/local/bin/mcpvault-entrypoint

RUN chmod +x /usr/local/bin/mcpvault-entrypoint \
    && mkdir -p /vault \
    && chown -R node:node /app /vault

USER node
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.PORT||8000; fetch('http://127.0.0.1:'+p+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["mcpvault-entrypoint"]
