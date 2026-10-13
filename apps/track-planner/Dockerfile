# A static site, so the image is just Caddy plus the files it serves.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html /srv/index.html
COPY css /srv/css
COPY js /srv/js
COPY vendor /srv/vendor
