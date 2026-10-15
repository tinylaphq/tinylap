# Built from the repository root:
#   docker build -f apps/timing/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) .
# As the planner's: one stage installs and assembles, the second runs the
# server with the assembled app in /srv and the server's modules from /repo.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@tinylap/timing-app..."
ARG GIT_SHA
RUN node tools/assemble.js apps/timing /out "$GIT_SHA"

FROM node:24-alpine
WORKDIR /repo
COPY --from=build /repo /repo
COPY --from=build /out /srv
# The volume is mounted here on Fly. The container runs as root because Fly
# mounts volumes root-owned.
RUN mkdir -p /data
ARG GIT_SHA
ENV NODE_ENV=production TINYLAP_BUILD=$GIT_SHA
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/timing/server/main.js"]
