FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM dependencies AS recovery
RUN apt-get update \
 && apt-get install -y --no-install-recommends sqlite3 util-linux ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 recovery \
 && mkdir -p /portal-data /recovery /run/portal-recovery-secrets \
 && chown -R recovery:recovery /portal-data /recovery /run/portal-recovery-secrets
COPY --chown=recovery:recovery . .
USER recovery
ENTRYPOINT ["node", "--experimental-strip-types", "scripts/portal-recovery.ts"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    PORTAL_DATA_DIR=/data
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
 && useradd --system --uid 10001 dashboard \
 && mkdir -p /data \
 && chown dashboard:dashboard /data
COPY --from=build --chown=dashboard:dashboard /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies --chown=dashboard:dashboard /app/node_modules ./node_modules
COPY --from=build --chown=dashboard:dashboard /app/dist ./dist
COPY --from=build --chown=dashboard:dashboard /app/.openai ./.openai
COPY --from=build --chown=dashboard:dashboard /app/db ./db
COPY --from=build --chown=dashboard:dashboard /app/runtime ./runtime
COPY --from=build --chown=dashboard:dashboard /app/scripts/config-encryption-key.mjs /app/scripts/identity-startup-policy.mjs /app/scripts/freeipa-gateway.mjs /app/scripts/node-runtime-http.mjs /app/scripts/node-worker-host.mjs /app/scripts/start-production.mjs ./scripts/
USER dashboard
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "--experimental-strip-types", "scripts/start-production.mjs"]
