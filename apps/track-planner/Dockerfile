# Built from the repository root: docker build -f apps/track-planner/Dockerfile .
# The first stage only lays files out (tools/assemble.js); nothing is compiled.
FROM node:24-alpine AS assemble
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@tinylap/track-planner..."
ARG GIT_SHA
RUN node tools/assemble.js apps/track-planner /out "$GIT_SHA"

FROM caddy:2-alpine
COPY apps/track-planner/Caddyfile /etc/caddy/Caddyfile
COPY --from=assemble /out /srv
