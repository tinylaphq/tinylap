# Built from the repository root:
#   docker build -f apps/track-planner/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) .
# One stage installs and assembles; the second runs the server with the
# assembled app in /srv and the server's own modules from /repo.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@tinylap/track-planner..."
ARG GIT_SHA
RUN node tools/assemble.js apps/track-planner /out "$GIT_SHA"

FROM node:24-alpine
WORKDIR /repo
COPY --from=build /repo /repo
COPY --from=build /out /srv
# The volume is mounted here on Fly; without one (CI, a quick local run) the
# database lives in the container and is lost with it. The container runs as
# root because Fly mounts volumes root-owned.
RUN mkdir -p /data
ARG GIT_SHA
ENV NODE_ENV=production TINYLAP_BUILD=$GIT_SHA
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/track-planner/server/main.js"]
