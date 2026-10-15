# Built from the repository root:
#   docker build -f apps/accounts/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) .
# Unlike the planner there is nothing to assemble: accounts serves palace-ui
# and @tinylap/design from its own node_modules, so the install is the app.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@tinylap/accounts..."

FROM node:24-alpine
WORKDIR /repo
COPY --from=build /repo /repo
# The volume is mounted here on Fly; without one (CI, a quick local run) the
# database lives in the container (or in memory with TINYLAP_DEV=1). The
# container runs as root because Fly mounts volumes root-owned.
RUN mkdir -p /data
ARG GIT_SHA
ENV NODE_ENV=production TINYLAP_BUILD=$GIT_SHA
EXPOSE 4100
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/accounts/server/main.js"]
