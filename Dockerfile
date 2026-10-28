# kraziTV: the server, the built web app, and FFmpeg in one image.
# Build:  docker build -t krazitv .
# Run:    see "Run with Docker" in README.md.

FROM node:22-trixie-slim AS build
# better-sqlite3 compiles from source when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:22-trixie-slim
LABEL org.opencontainers.image.source="https://github.com/ridloncmr/kraziTV" \
  org.opencontainers.image.description="kraziTV: a linear TV channel simulator for Plex"
# FFmpeg and ffprobe for probing and streaming; a font for the filler screen.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# kraziTV's license and the notices for everything else in this image.
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir /data && chown node:node /data

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  KRAZITV_DATA_DIR=/data
VOLUME /data
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
