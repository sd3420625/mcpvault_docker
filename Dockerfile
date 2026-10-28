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

# Use the published server rather than the historical source snapshot in this fork.
# The installed lockfile is retained in the image for auditing its exact dependency tree.
RUN npm init -y \
    && npm install --omit=dev --save-exact \
       "@bitbonsai/mcpvault@${MCPVAULT_VERSION}" \
       "supergateway@${SUPERGATEWAY_VERSION}" \
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
