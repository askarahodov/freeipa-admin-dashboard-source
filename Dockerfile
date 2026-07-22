FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0
WORKDIR /app
RUN useradd --system --uid 10001 dashboard && mkdir -p /app/.wrangler && chown dashboard:dashboard /app/.wrangler
COPY --from=build --chown=dashboard:dashboard /app/package.json /app/package-lock.json ./
COPY --from=build --chown=dashboard:dashboard /app/node_modules ./node_modules
COPY --from=build --chown=dashboard:dashboard /app/dist ./dist
COPY --from=build --chown=dashboard:dashboard /app/.openai ./.openai
COPY --from=build --chown=dashboard:dashboard /app/scripts/start-worker.mjs ./scripts/start-worker.mjs
USER dashboard
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/integrations/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["npm", "run", "start:docker"]
