# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-bookworm-slim
FROM node:${NODE_VERSION} AS runtime

ARG MCPVAULT_VERSION=0.17.1
ARG SUPERGATEWAY_VERSION=4.2.1
ARG VCS_REF=unknown

LABEL org.opencontainers.image.source="https://github.com/sd3420625/mcpvault_docker" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${MCPVAULT_VERSION}-sg${SUPERGATEWAY_VERSION}"

ENV NODE_ENV=production \
    VAULT_PATH=/vault \
    PORT=8000 \
    MCP_PATH=/mcp \
    SESSION_TIMEOUT=60000 \
    LOG_LEVEL=info \
    MCP_READ_ONLY=false \
    PATH="/app/node_modules/.bin:${PATH}"

WORKDIR /app

COPY docker/runtime-package.json ./package.json
COPY docker/runtime-package-lock.json ./package-lock.json

# Install the exact audited tree; the fork's historical source is not part of the image.
RUN node -e 'const p=require("./package-lock.json").packages; for(const [name,want] of Object.entries({"@bitbonsai/mcpvault":process.env.MCPVAULT_VERSION,supergateway:process.env.SUPERGATEWAY_VERSION})){if(p["node_modules/"+name]?.version!==want)throw new Error("Build version must match the runtime lockfile: "+name)}' \
    && npm ci --omit=dev \
    && npm cache clean --force

COPY docker/entrypoint.sh /usr/local/bin/mcpvault-entrypoint
COPY docker/mcpvault-stdio.mjs /app/docker/mcpvault-stdio.mjs

RUN chmod +x /usr/local/bin/mcpvault-entrypoint \
    && mkdir -p /vault \
    && chown -R node:node /app /vault

USER node
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=15s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||8000; fetch('http://127.0.0.1:'+p+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["mcpvault-entrypoint"]
