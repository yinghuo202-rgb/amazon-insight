# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS web-builder
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /build

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY automation/integrations/amazon-insight/package.json automation/integrations/amazon-insight/pnpm-lock.yaml automation/integrations/amazon-insight/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY automation/integrations/amazon-insight/ ./
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/data/app/selection.db \
    STORE_OPS_AUTOMATION_ROOT=/opt/store-ops \
    STORE_OPS_DATA_ROOT=/data/sources \
    STORE_OPS_RUNTIME_ROOT=/data/runtime \
    STORE_OPS_STATE_DB=/data/runtime/db/operations.sqlite3 \
    STORE_OPS_PYTHON=/opt/store-ops-venv/bin/python \
    PYTHONPATH=/opt/store-ops/src \
    PATH=/opt/store-ops-venv/bin:$PATH

RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/store-ops-venv

WORKDIR /app
COPY --from=web-builder /build/.next/standalone ./
COPY --from=web-builder /build/.next/static ./.next/static
COPY --from=web-builder /build/public ./public
COPY --from=web-builder /build/node_modules ./node_modules
COPY --from=web-builder /build/package.json ./package.json
COPY --from=web-builder /build/prisma ./prisma

COPY automation/pyproject.toml /opt/store-ops/pyproject.toml
COPY automation/src /opt/store-ops/src
COPY automation/config /opt/store-ops/config
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN /opt/store-ops-venv/bin/pip install --no-cache-dir /opt/store-ops \
  && mkdir -p /data/app /data/runtime/db /data/logs /data/sources \
  && chmod 0755 /usr/local/bin/docker-entrypoint.sh \
  && chown -R node:node /app /data /opt/store-ops

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
