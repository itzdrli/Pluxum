# syntax=docker/dockerfile:1.7
# Pluxum production images. Two targets share one build:
#   docker build --target server -t pluxum-server .   # Pluxel host: one standalone bundle
#   docker build --target web    -t pluxum-web .      # React Router SSR frontend
# Pluxel is not on npm yet, so the build checks out the framework at a pinned commit and links it
# into the workspace the same way local development does (`pluxel source install`).

ARG NODE_IMAGE=node:24.22.0-bookworm-slim

FROM ${NODE_IMAGE} AS base
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1
RUN corepack enable

# --- Framework checkout -------------------------------------------------------------------------
FROM base AS pluxel
ARG PLUXEL_REPO=https://github.com/PluxelJS/pluxel.git
ARG PLUXEL_REF=f09aa542f
WORKDIR /src/pluxel
RUN git clone --filter=blob:none "${PLUXEL_REPO}" . \
	&& git -c advice.detachedHead=false checkout "${PLUXEL_REF}" \
	&& git submodule update --init --depth 1 --recursive
RUN pnpm install --frozen-lockfile
RUN pnpm exec vp run @pluxel/cli#compile

# --- Workspace build ----------------------------------------------------------------------------
FROM pluxel AS build
WORKDIR /src/pluxum
COPY . .
RUN node /src/pluxel/packages/cli/bin/pluxel.mjs source register /src/pluxel \
	&& node /src/pluxel/packages/cli/bin/pluxel.mjs source install --root . --frozen-lockfile
RUN pnpm exec vp run workspace:build
# The frontend's production dependencies only, resolved from the workspace lockfile.
RUN pnpm --config.inject-workspace-packages=true --filter @pluxum/web \
	deploy --prod --ignore-scripts /out/web

# --- Server image -------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS server
LABEL org.opencontainers.image.source=https://github.com/itzdrli/Pluxum \
	org.opencontainers.image.description="Pluxum forum server (Pluxel host)" \
	org.opencontainers.image.licenses=AGPL-3.0-only
ENV NODE_ENV=production \
	PLUXEL_DATA_ROOT=/data/.pluxel \
	PLUXEL_HOST_BIND=0.0.0.0 \
	PLUXEL_HOST_PORT=3000 \
	PLUXUM_ADMIN_PORT=8080
COPY --from=build /src/pluxum/host/dist /app
RUN mkdir -p /data && chown node:node /data
USER node
# Local attachment storage resolves against the working directory, so it lands in the volume too.
WORKDIR /data
VOLUME /data
EXPOSE 3000 8080
CMD ["node", "/app/app.mjs"]

# --- Web image ----------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS web
LABEL org.opencontainers.image.source=https://github.com/itzdrli/Pluxum \
	org.opencontainers.image.description="Pluxum forum frontend (React Router SSR)" \
	org.opencontainers.image.licenses=AGPL-3.0-only
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /out/web/package.json ./
COPY --from=build /out/web/node_modules ./node_modules
COPY --from=build /src/pluxum/apps/web/build ./build
COPY --from=build /src/pluxum/apps/web/server.mjs ./
USER node
EXPOSE 3000
CMD ["node", "node_modules/@react-router/serve/bin.cjs", "./server.mjs"]
