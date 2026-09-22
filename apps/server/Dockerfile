# --- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo

# Install with the workspace lockfile so the build is reproducible.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --workspace @uno-arena/server --include-workspace-root

COPY apps/server apps/server
RUN npm run build --workspace @uno-arena/server

# --- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev --ignore-scripts --workspace @uno-arena/server --include-workspace-root \
  && npm cache clean --force

COPY --from=build /repo/apps/server/dist apps/server/dist

# Run unprivileged.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/server.js"]
