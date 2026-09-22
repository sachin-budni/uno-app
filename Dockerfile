# ---------------------------------------------------------------------------
# Single-service production image.
#
# Runs JSON Server and the Node API in one container, with the API also serving
# the built Angular client - so the whole game answers on one port and one
# origin, which is what `environment.production.ts` expects.
#
# `docker-compose.yml` and the per-app Dockerfiles remain for the three-service
# local topology; this one is for a PaaS that deploys a single image.
# ---------------------------------------------------------------------------

# --- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# esbuild ships its platform binary as an optionalDependency, so skipping
# scripts here is safe; postinstall only creates data/db.json.
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# json-server is a runtime dependency here (it is the database), so --omit=dev
# still installs it. Scoping to the server workspace keeps the Angular toolchain
# out of the runtime image - the client is already built by then.
# --ignore-scripts is required: postinstall runs scripts/ensure-db.mjs, which is
# not copied in until later.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts --workspace @uno-arena/server --include-workspace-root && npm cache clean --force

COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/web/dist apps/web/dist
COPY scripts scripts

# Seed database. DB_PATH usually points at a mounted disk instead.
COPY data/db.json data/db.json
RUN chown -R node:node /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/start-production.mjs"]
